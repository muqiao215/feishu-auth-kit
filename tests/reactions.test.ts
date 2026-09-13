import { describe, it, expect, vi } from "vitest";
import {
  addReaction,
  removeReaction,
  listReactions,
  withReactionLifecycle,
  COMMON_EMOJI,
} from "../src/reactions.js";
import { FeishuAuthClient, FeishuApiError } from "../src/client.js";

describe("Feishu IM Reactions", () => {
  it("rejects invalid emoji types upfront", async () => {
    const client = new FeishuAuthClient("app123", "secret123");
    await expect(addReaction(client, "om_123", "NON_EXISTENT_EMOJI")).rejects.toThrow(
      FeishuApiError
    );
  });

  it("calls addReaction and parses reactionId", async () => {
    let capturedUrl = "";
    let capturedBody: any = null;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      if (url.includes("/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-mock-token" }));
      }
      if (url.includes("/reactions")) {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ code: 0, data: { reaction_id: "react_999" } }));
      }
      return new Response(JSON.stringify({ code: 0 }));
    });

    const client = new FeishuAuthClient("app123", "secret123", { fetchFn: mockFetch });
    const res = await addReaction(client, "om_123", COMMON_EMOJI.THINKING);

    expect(res.reactionId).toBe("react_999");
    expect(capturedUrl).toContain("/open-apis/im/v1/messages/om_123/reactions");
    expect(capturedBody.reaction_type.emoji_type).toBe("THINKING");
  });

  it("calls removeReaction with DELETE method", async () => {
    let capturedMethod = "";
    let capturedUrl = "";

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method || "GET";
      if (url.includes("/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-mock-token" }));
      }
      return new Response(JSON.stringify({ code: 0 }));
    });

    const client = new FeishuAuthClient("app123", "secret123", { fetchFn: mockFetch });
    await removeReaction(client, "om_123", "react_999");

    expect(capturedMethod).toBe("DELETE");
    expect(capturedUrl).toContain("/open-apis/im/v1/messages/om_123/reactions/react_999");
  });

  it("lists reactions and maps to FeishuReaction objects", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-mock-token" }));
      }
      if (url.includes("/reactions")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              items: [
                {
                  reaction_id: "react_1",
                  reaction_type: { emoji_type: "THUMBSUP" },
                  operator: { operator_type: "user", operator_id: "ou_user1" },
                },
                {
                  reaction_id: "react_2",
                  reaction_type: { emoji_type: "DONE" },
                  operator: { operator_type: "app", operator_id: "cli_app1" },
                },
              ],
            },
          })
        );
      }
      return new Response(JSON.stringify({ code: 0 }));
    });

    const client = new FeishuAuthClient("app123", "secret123", { fetchFn: mockFetch });
    const list = await listReactions(client, "om_123", "THUMBSUP");

    expect(list.length).toBe(2);
    expect(list[0]).toEqual({
      reactionId: "react_1",
      emojiType: "THUMBSUP",
      operatorType: "user",
      operatorId: "ou_user1",
    });
    expect(list[1].operatorType).toBe("app");
  });

  it("handles withReactionLifecycle: adds thinking, deletes thinking, and adds done", async () => {
    const events: string[] = [];

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-mock-token" }));
      }
      if (init?.method === "POST") {
        const b = JSON.parse(init.body as string);
        events.push(`ADD_${b.reaction_type.emoji_type}`);
        return new Response(JSON.stringify({ code: 0, data: { reaction_id: `id_${b.reaction_type.emoji_type}` } }));
      }
      if (init?.method === "DELETE") {
        events.push("REMOVE");
        return new Response(JSON.stringify({ code: 0 }));
      }
      return new Response(JSON.stringify({ code: 0 }));
    });

    const client = new FeishuAuthClient("app123", "secret123", { fetchFn: mockFetch });

    const res = await withReactionLifecycle(client, "om_123", async () => {
      events.push("EXEC_TASK");
      return "SUCCESS_DATA";
    });

    expect(res).toBe("SUCCESS_DATA");
    expect(events).toEqual(["ADD_THINKING", "EXEC_TASK", "REMOVE", "ADD_DONE"]);
  });
});
