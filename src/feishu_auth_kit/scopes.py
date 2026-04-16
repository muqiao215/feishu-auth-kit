from __future__ import annotations

from collections.abc import Iterable

CORE_APP_SCOPES = [
    "application:application:self_manage",
    "offline_access",
]

SENSITIVE_SCOPES = [
    "im:message.send_as_user",
    "space:document:delete",
    "calendar:calendar.event:delete",
    "base:table:delete",
]

INITIAL_SCOPE_CATALOG = {
    "application:application:self_manage": {
        "token_types": ["tenant"],
        "description": "Inspect app metadata and granted scopes.",
    },
    "offline_access": {
        "token_types": ["user"],
        "description": "Return refresh tokens for device-flow user auth.",
    },
    "im:message:readonly": {
        "token_types": ["user", "tenant"],
        "description": "Read message content.",
    },
    "im:message:send_as_bot": {
        "token_types": ["tenant"],
        "description": "Send bot messages.",
    },
    "im:chat:read": {
        "token_types": ["tenant"],
        "description": "Read chat metadata.",
    },
    "calendar:calendar:read": {
        "token_types": ["user"],
        "description": "Read user calendars.",
    },
    "calendar:calendar.event:delete": {
        "token_types": ["user"],
        "description": "Delete calendar events.",
        "sensitive": True,
    },
    "space:document:delete": {
        "token_types": ["user"],
        "description": "Delete cloud docs.",
        "sensitive": True,
    },
}


def _dedupe_preserve_order(scopes: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    items: list[str] = []
    for scope in scopes:
        normalized = scope.strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            items.append(normalized)
    return items


def filter_sensitive_scopes(scopes: Iterable[str]) -> list[str]:
    sensitive = set(SENSITIVE_SCOPES)
    return [scope for scope in _dedupe_preserve_order(scopes) if scope not in sensitive]


def batch_scopes(scopes: Iterable[str], batch_size: int = 100) -> list[list[str]]:
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    unique_scopes = _dedupe_preserve_order(scopes)
    return [
        unique_scopes[index : index + batch_size]
        for index in range(0, len(unique_scopes), batch_size)
    ]


def summarize_scope_batches(batches: Iterable[Iterable[str]]) -> list[str]:
    return [
        f"Batch {index}: {len(list(batch))} scopes"
        for index, batch in enumerate(batches, start=1)
    ]


def missing_core_scopes(scopes: Iterable[str]) -> list[str]:
    granted = set(_dedupe_preserve_order(scopes))
    return [scope for scope in CORE_APP_SCOPES if scope not in granted]

