#!/usr/bin/env python3
"""Watch OpenClaw Feishu upstreams and open sync issues in this repo."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


API_ROOT = "https://api.github.com"
DEFAULT_OWNER = "muqiao215"
DEFAULT_REPO = "feishu-auth-kit"
LABEL_NAME = "upstream-watch"
LABEL_COLOR = "0E8A16"
LABEL_DESCRIPTION = "Automated upstream monitoring issue"
USER_AGENT = "feishu-auth-kit-upstream-watch"
LOW_SIGNAL_KINDS = {"docs", "style"}
FORMAT_HINTS = ("format", "fmt", "prettier", "lint", "whitespace")
CORE_MESSAGE_HINTS = ("channel", "plugin", "sdk", "contract", "interactive", "card", "task")
MERGE_NOISE_PREFIXES = (
    "merge branch 'main' into",
    'merge remote-tracking branch "origin/main" into',
    "merge remote-tracking branch 'origin/main' into",
)


@dataclass(frozen=True)
class WatchTarget:
    key: str
    repo: str
    branch: str
    mode: str


TARGETS = (
    WatchTarget(
        key="openclaw-lark",
        repo="larksuite/openclaw-lark",
        branch="main",
        mode="plugin",
    ),
    WatchTarget(
        key="openclaw-core",
        repo="openclaw/openclaw",
        branch="main",
        mode="core",
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Watch OpenClaw Feishu upstreams and open sync issues.",
    )
    parser.add_argument("--owner", default=DEFAULT_OWNER, help="Issue target owner.")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="Issue target repository.")
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=14,
        help="Only consider commits newer than this many days.",
    )
    parser.add_argument(
        "--per-target-limit",
        type=int,
        default=20,
        help="How many recent commits to inspect per upstream target.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print candidate issues instead of creating them.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        print("Missing GITHUB_TOKEN or GH_TOKEN", file=sys.stderr)
        return 2

    session = GitHubSession(token=token)
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=args.lookback_days)
    results: list[dict[str, Any]] = []

    if not args.dry_run:
        ensure_label(session, owner=args.owner, repo=args.repo)

    for target in TARGETS:
        commits = fetch_commits(
            session,
            repo=target.repo,
            branch=target.branch,
            per_page=args.per_target_limit,
        )
        for item in commits:
            sha = item["sha"]
            commit_date = parse_github_datetime(item["commit"]["committer"]["date"])
            if commit_date < since:
                continue

            detail = fetch_commit_detail(session, repo=target.repo, sha=sha)
            candidate = classify_commit(target, detail)
            if candidate is None:
                continue

            title = issue_title(target, detail)
            existing = find_existing_issue(
                session,
                owner=args.owner,
                repo=args.repo,
                title=title,
            )
            if existing is not None:
                results.append(
                    {
                        "target": target.key,
                        "sha": sha,
                        "action": "skip_existing",
                        "issue_number": existing["number"],
                    }
                )
                continue

            body = issue_body(target, detail, candidate)
            if args.dry_run:
                print(json.dumps({"title": title, "body": body}, ensure_ascii=False, indent=2))
                results.append({"target": target.key, "sha": sha, "action": "dry_run"})
            else:
                created = create_issue(
                    session,
                    owner=args.owner,
                    repo=args.repo,
                    title=title,
                    body=body,
                )
                results.append(
                    {
                        "target": target.key,
                        "sha": sha,
                        "action": "created",
                        "issue_number": created["number"],
                    }
                )

    print(json.dumps({"results": results}, ensure_ascii=False, indent=2))
    return 0


class GitHubSession:
    def __init__(self, *, token: str) -> None:
        self._token = token

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{API_ROOT}/{path.lstrip('/')}"
        if params:
            query = urllib.parse.urlencode(params, doseq=True)
            url = f"{url}?{query}"
        payload = None
        headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self._token}",
            "User-Agent": USER_AGENT,
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"GitHub API {method} {url} failed: {exc.code} {detail}") from exc
        if not raw:
            return None
        return json.loads(raw)


def fetch_commits(
    session: GitHubSession,
    *,
    repo: str,
    branch: str,
    per_page: int,
) -> list[dict[str, Any]]:
    return session.request(
        "GET",
        f"repos/{repo}/commits",
        params={"sha": branch, "per_page": per_page},
    )


def fetch_commit_detail(session: GitHubSession, *, repo: str, sha: str) -> dict[str, Any]:
    return session.request("GET", f"repos/{repo}/commits/{sha}")


def classify_commit(target: WatchTarget, detail: dict[str, Any]) -> dict[str, Any] | None:
    message = detail["commit"]["message"].splitlines()[0].strip()
    files = detail.get("files") or []
    filenames = [str(item.get("filename") or "") for item in files]
    lower_message = message.lower()
    lower_files = [name.lower() for name in filenames]

    if is_low_signal_commit(lower_message):
        return None

    if target.mode == "plugin":
        reasons = []
        relevant = False
        has_src = False
        has_tests = False
        has_manifest = False
        has_dependency = False
        for name in lower_files:
            if name.startswith("src/"):
                relevant = True
                has_src = True
                reasons.append("src")
            elif name.startswith("tests/"):
                relevant = True
                has_tests = True
                reasons.append("tests")
            elif name == "openclaw.plugin.json":
                relevant = True
                has_manifest = True
                reasons.append("manifest")
            elif name == "package.json":
                relevant = True
                has_dependency = True
                reasons.append("dependency")
        if not relevant:
            return None
        if has_tests and not (has_src or has_manifest or has_dependency) and has_any(
            lower_message,
            FORMAT_HINTS,
        ):
            return None
        return {"message": message, "filenames": filenames, "reasons": sorted(set(reasons))}

    message_hits = keyword_hits(lower_message)
    file_hits = []
    contract_non_test = False
    contract_test = False
    for name in lower_files:
        if "feishu" in name:
            file_hits.append("feishu")
        if "lark" in name:
            file_hits.append("lark")
        if is_core_contract_path(name):
            if is_test_file(name):
                contract_test = True
            else:
                contract_non_test = True

    reasons = sorted(set(message_hits + file_hits))
    if contract_non_test:
        reasons.append("plugin-sdk-contract")
    elif contract_test and (message_hits or has_any(lower_message, CORE_MESSAGE_HINTS)):
        reasons.append("plugin-sdk-contract-test")

    reasons = sorted(set(reasons))
    if not reasons:
        return None
    return {"message": message, "filenames": filenames, "reasons": reasons}


def keyword_hits(text: str) -> list[str]:
    hits: list[str] = []
    for word in ("feishu", "lark", "plugin-sdk", "openclaw-lark"):
        if word in text:
            hits.append(word)
    return hits


def commit_kind(message: str) -> str:
    prefix = message.split(":", 1)[0].strip()
    return prefix.split("(", 1)[0].strip()


def is_low_signal_commit(message: str) -> bool:
    kind = commit_kind(message)
    if kind in LOW_SIGNAL_KINDS:
        return True
    if kind == "chore" and has_any(message, FORMAT_HINTS):
        return True
    if message.startswith(MERGE_NOISE_PREFIXES):
        return True
    return False


def has_any(text: str, needles: tuple[str, ...] | list[str] | set[str]) -> bool:
    return any(needle in text for needle in needles)


def is_test_file(name: str) -> bool:
    return (
        "/test/" in name
        or "/tests/" in name
        or name.startswith("test/")
        or name.startswith("tests/")
        or name.endswith(".test.ts")
        or name.endswith(".test.tsx")
        or name.endswith(".spec.ts")
        or name.endswith(".spec.tsx")
        or name.endswith("_test.py")
    )


def is_core_contract_path(name: str) -> bool:
    if "plugin-sdk" not in name:
        return False
    return has_any(name, ("channel", "plugin", "entry", "contract"))


def issue_title(target: WatchTarget, detail: dict[str, Any]) -> str:
    sha = detail["sha"][:7]
    return f"[upstream-watch] {target.key} changed at {sha}"


def issue_body(target: WatchTarget, detail: dict[str, Any], candidate: dict[str, Any]) -> str:
    sha = detail["sha"]
    short_sha = sha[:7]
    message = candidate["message"]
    compare_url = detail.get("html_url") or f"https://github.com/{target.repo}/commit/{sha}"
    files = candidate["filenames"][:20]
    reasons = ", ".join(candidate["reasons"])
    bullet_files = "\n".join(f"- `{name}`" for name in files) if files else "- `(no file list)`"
    return (
        f"Upstream watcher detected a Feishu-relevant change.\n\n"
        f"- Upstream: `{target.repo}`\n"
        f"- Branch: `{target.branch}`\n"
        f"- Commit: `{short_sha}`\n"
        f"- URL: {compare_url}\n"
        f"- Signal: `{reasons}`\n"
        f"- Summary: {message}\n\n"
        f"## Changed files\n"
        f"{bullet_files}\n\n"
        f"## Sync checklist\n"
        f"- [ ] Review upstream commit in `{target.repo}`\n"
        f"- [ ] Decide whether this affects OpenClaw Feishu interface or official plugin behavior\n"
        f"- [ ] Sync required changes into `muqiao215/feishu-auth-kit`\n"
        f"- [ ] Add or update regression tests in `feishu-auth-kit`\n"
        f"- [ ] Close this issue once sync is done\n"
    )


def ensure_label(session: GitHubSession, *, owner: str, repo: str) -> None:
    try:
        session.request("GET", f"repos/{owner}/{repo}/labels/{LABEL_NAME}")
        return
    except RuntimeError as exc:
        if "404" not in str(exc):
            raise
    session.request(
        "POST",
        f"repos/{owner}/{repo}/labels",
        body={"name": LABEL_NAME, "color": LABEL_COLOR, "description": LABEL_DESCRIPTION},
    )


def find_existing_issue(
    session: GitHubSession,
    *,
    owner: str,
    repo: str,
    title: str,
) -> dict[str, Any] | None:
    query = f'repo:{owner}/{repo} in:title "{title}"'
    result = session.request("GET", "search/issues", params={"q": query, "per_page": 1})
    items = result.get("items") or []
    return items[0] if items else None


def create_issue(
    session: GitHubSession,
    *,
    owner: str,
    repo: str,
    title: str,
    body: str,
) -> dict[str, Any]:
    return session.request(
        "POST",
        f"repos/{owner}/{repo}/issues",
        body={"title": title, "body": body, "labels": [LABEL_NAME]},
    )


def parse_github_datetime(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


if __name__ == "__main__":
    raise SystemExit(main())
