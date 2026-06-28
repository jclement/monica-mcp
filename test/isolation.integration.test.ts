import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { bootTestApp, createTestUser, createMonicaAccount, type TestApp } from "./helpers.ts";
import { startFakeMonica, type FakeMonica } from "./fake-monica-api.ts";
import { createApiToken } from "../src/auth/tokens.ts";

let app: TestApp;
let monica: FakeMonica;
let clientA: Client;
let clientB: Client;
let userA: number;
let userB: number;

function jsonOf(result: CallToolResult): any {
  const block = result.content.find((c) => c.type === "text");
  return block && block.type === "text" ? JSON.parse(block.text) : null;
}
function textOf(result: CallToolResult): string {
  const block = result.content.find((c) => c.type === "text");
  return block && block.type === "text" ? block.text : "";
}

async function connect(baseUrl: string, token: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

beforeAll(async () => {
  app = await bootTestApp();
  monica = startFakeMonica();
  const { db, config } = app;

  userA = createTestUser(db, "Alice");
  userB = createTestUser(db, "Bob");
  // Both point at the same fake Monica, but with DISTINCT tokens — so the only
  // thing distinguishing their calls is which token the server forwards.
  createMonicaAccount(db, config.masterKey, userA, monica.url, "TOK-ALICE-aaaa");
  createMonicaAccount(db, config.masterKey, userB, monica.url, "TOK-BOB-bbbb");

  const tokenA = createApiToken(db, userA, "alice-cli").token;
  const tokenB = createApiToken(db, userB, "bob-cli").token;
  clientA = await connect(app.baseUrl, tokenA);
  clientB = await connect(app.baseUrl, tokenB);
});

afterAll(async () => {
  await clientA?.close();
  await clientB?.close();
  monica?.close();
  await app?.close();
});

describe("tenant isolation", () => {
  test("both users see the same static Monica tool set", async () => {
    const a = (await clientA.listTools()).tools.map((t) => t.name).sort();
    const b = (await clientB.listTools()).tools.map((t) => t.name).sort();
    expect(a).toEqual(b);
    expect(a).toContain("me");
    expect(a).toContain("list_contacts");
    expect(a).toContain("create_note");
  });

  test("a tool call reaches Monica carrying THIS user's token", async () => {
    const result = (await clientA.callTool({ name: "me" })) as CallToolResult;
    expect(jsonOf(result).data.tokenTail).toBe("aaaa"); // tail of TOK-ALICE-aaaa
  });

  test("tokens never cross: Bob's call carries Bob's token, not Alice's", async () => {
    const result = (await clientB.callTool({ name: "me" })) as CallToolResult;
    expect(jsonOf(result).data.tokenTail).toBe("bbbb");
  });

  test("a write tool forwards the caller's token", async () => {
    const result = (await clientA.callTool({
      name: "create_note",
      arguments: { data: { contact_id: 1, body: "hi" } },
    })) as CallToolResult;
    expect(jsonOf(result).tokenTail).toBe("aaaa");
  });

  test("a user with no Monica account gets NO_ACCOUNT, not someone else's", async () => {
    const userC = createTestUser(app.db, "Carol");
    const tokenC = createApiToken(app.db, userC, "carol-cli").token;
    const clientC = await connect(app.baseUrl, tokenC);
    try {
      const result = (await clientC.callTool({ name: "me" })) as CallToolResult;
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("NO_ACCOUNT");
    } finally {
      await clientC.close();
    }
  });

  test("unknown tool names are rejected", async () => {
    const result = (await clientA.callTool({ name: "definitely_not_a_tool" })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("UNKNOWN_TOOL");
  });

  test("audit log records calls under the right user", async () => {
    const rows = app.db
      .query<{ user_id: number; event: string; status: string }, []>(
        "SELECT user_id, event, status FROM audit_log WHERE source = 'agent' AND event = 'me' ORDER BY id",
      )
      .all();
    const alice = rows.find((r) => r.user_id === userA);
    const bob = rows.find((r) => r.user_id === userB);
    expect(alice).toBeTruthy();
    expect(bob).toBeTruthy();
    expect(alice!.user_id).not.toBe(bob!.user_id);
  });
});
