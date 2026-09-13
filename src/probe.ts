import { FeishuAuthClient } from "./client.js";

export const AI_AGENT_PING_PATH = "/open-apis/bot/v1/openclaw_bot/ping";

export interface FeishuProbeResult {
  ok: boolean;
  app_id?: string | null;
  bot_name?: string | null;
  bot_open_id?: string | null;
  error?: string | null;
  raw?: Record<string, any>;
}

export async function registerAiAgent(client: FeishuAuthClient): Promise<FeishuProbeResult> {
  try {
    const tenantToken = (await client.getTenantAccessToken()).token;
    const url = `${client.domains.openBase}${AI_AGENT_PING_PATH}`;

    const response = await client.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ needBotInfo: true }),
      signal: AbortSignal.timeout(client.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        ok: false,
        app_id: client.appId,
        error: `HTTP ${response.status}: ${errText}`,
      };
    }

    const payload = await response.json();
    if (payload?.code !== 0 && payload?.code !== undefined && payload?.code !== null) {
      return {
        ok: false,
        app_id: client.appId,
        error: payload.msg || payload.message || "Unknown error",
        raw: payload,
      };
    }

    const botInfo = payload?.data?.pingBotInfo || {};
    return {
      ok: true,
      app_id: client.appId,
      bot_name: botInfo.botName ?? null,
      bot_open_id: botInfo.botID ?? null,
      raw: payload,
    };
  } catch (exc: any) {
    return {
      ok: false,
      app_id: client.appId,
      error: exc?.message || String(exc),
    };
  }
}

export async function probeAiAgentCredentials(
  appId: string,
  appSecret: string,
  options?: {
    brand?: string;
    fetchFn?: any;
  }
): Promise<FeishuProbeResult> {
  const client = new FeishuAuthClient(appId, appSecret, options);
  return registerAiAgent(client);
}
