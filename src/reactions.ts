/**
 * Feishu IM Message Reactions (Emoji status & reactions).
 *
 * Provides typed reaction helpers for agent execution lifecycles:
 * e.g. adding THINKING reaction while processing, replacing with DONE or ERROR upon completion.
 */

import { FeishuAuthClient, FeishuApiError } from "./client.js";

export const COMMON_EMOJI = {
  THINKING: "THINKING",
  DONE: "DONE",
  OK: "OK",
  ERROR: "ERROR",
  LGTM: "LGTM",
  ON_IT: "OnIt",
  ONE_SECOND: "OneSecond",
  CHECK_MARK: "CheckMark",
  CROSS_MARK: "CrossMark",
  THUMBSUP: "THUMBSUP",
  SMILE: "SMILE",
} as const;

export const VALID_FEISHU_EMOJI_TYPES: ReadonlySet<string> = new Set([
  "OK",
  "THUMBSUP",
  "THANKS",
  "MUSCLE",
  "FINGERHEART",
  "APPLAUSE",
  "FISTBUMP",
  "JIAYI",
  "DONE",
  "SMILE",
  "BLUSH",
  "LAUGH",
  "SMIRK",
  "LOL",
  "FACEPALM",
  "LOVE",
  "WINK",
  "PROUD",
  "WITTY",
  "SMART",
  "SCOWL",
  "THINKING",
  "SOB",
  "CRY",
  "ERROR",
  "SILENT",
  "WAVE",
  "WHAT",
  "FROWN",
  "SHY",
  "DIZZY",
  "LOOKDOWN",
  "CHUCKLE",
  "WAIL",
  "CRAZY",
  "WHIMPER",
  "HUG",
  "WRONGED",
  "HUSKY",
  "SHHH",
  "SMUG",
  "ANGRY",
  "HAMMER",
  "SHOCKED",
  "TERROR",
  "SKULL",
  "SWEAT",
  "SPEECHLESS",
  "SLEEP",
  "Get",
  "LGTM",
  "OnIt",
  "OneSecond",
  "SALUTE",
  "SHAKE",
  "HIGHFIVE",
  "ThumbsDown",
  "Yes",
  "No",
  "OKR",
  "CheckMark",
  "CrossMark",
  "MinusOne",
  "Hundred",
  "Fire",
  "BOMB",
  "Music",
  "PARTY",
  "HEART",
]);

export interface FeishuReaction {
  reactionId: string;
  emojiType: string;
  operatorType: "app" | "user";
  operatorId: string;
}

/**
 * Add an emoji reaction to a message.
 */
export async function addReaction(
  client: FeishuAuthClient,
  messageId: string,
  emojiType: string
): Promise<{ reactionId: string }> {
  if (!VALID_FEISHU_EMOJI_TYPES.has(emojiType)) {
    throw new FeishuApiError(
      `Invalid Feishu emoji type "${emojiType}". Valid types include: THINKING, DONE, OK, LGTM, OnIt, CheckMark...`
    );
  }

  const endpoint = `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions`;
  const res = await client.requestWithTenantToken(endpoint, {
    method: "POST",
    body: {
      reaction_type: {
        emoji_type: emojiType,
      },
    },
  });

  const reactionId = res?.data?.reaction_id;
  if (!reactionId) {
    throw new FeishuApiError(`Failed to get reaction_id from Feishu response`);
  }

  return { reactionId };
}

/**
 * Remove a specific reaction by reactionId.
 */
export async function removeReaction(
  client: FeishuAuthClient,
  messageId: string,
  reactionId: string
): Promise<void> {
  const endpoint = `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(reactionId)}`;
  await client.requestWithTenantToken(endpoint, {
    method: "DELETE",
  });
}

/**
 * List reactions on a message with optional emoji filter.
 */
export async function listReactions(
  client: FeishuAuthClient,
  messageId: string,
  emojiType?: string
): Promise<FeishuReaction[]> {
  const endpoint = `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions`;
  const params: Record<string, string> = { page_size: "50" };
  if (emojiType) {
    params.reaction_type = emojiType;
  }

  const res = await client.requestWithTenantToken(endpoint, {
    method: "GET",
    params,
  });

  const items = res?.data?.items || [];
  return items.map((item: any) => ({
    reactionId: String(item.reaction_id ?? ""),
    emojiType: String(item.reaction_type?.emoji_type ?? ""),
    operatorType: item.operator?.operator_type === "app" ? "app" : "user",
    operatorId: String(item.operator?.operator_id ?? ""),
  }));
}

/**
 * Higher-level helper: Wraps an async task with automatic reaction status updates.
 * Adds thinking emoji on start, and replaces/adds done or error emoji on finish.
 */
export async function withReactionLifecycle<T>(
  client: FeishuAuthClient,
  messageId: string,
  task: () => Promise<T>,
  options?: {
    thinkingEmoji?: string;
    doneEmoji?: string;
    errorEmoji?: string;
    removeThinkingOnFinish?: boolean;
  }
): Promise<T> {
  const thinkingEmoji = options?.thinkingEmoji ?? COMMON_EMOJI.THINKING;
  const doneEmoji = options?.doneEmoji ?? COMMON_EMOJI.DONE;
  const errorEmoji = options?.errorEmoji ?? COMMON_EMOJI.ERROR;
  const removeThinking = options?.removeThinkingOnFinish ?? true;

  let thinkingReactionId: string | null = null;
  try {
    const res = await addReaction(client, messageId, thinkingEmoji);
    thinkingReactionId = res.reactionId;
  } catch {
    // Non-fatal if reaction fails (e.g. missing scope)
  }

  try {
    const result = await task();

    if (thinkingReactionId && removeThinking) {
      await removeReaction(client, messageId, thinkingReactionId).catch(() => {});
    }
    if (doneEmoji) {
      await addReaction(client, messageId, doneEmoji).catch(() => {});
    }

    return result;
  } catch (err) {
    if (thinkingReactionId && removeThinking) {
      await removeReaction(client, messageId, thinkingReactionId).catch(() => {});
    }
    if (errorEmoji) {
      await addReaction(client, messageId, errorEmoji).catch(() => {});
    }
    throw err;
  }
}
