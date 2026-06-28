import { describe, expect, test } from "bun:test";
import { Metrics } from "../src/metrics.ts";
import { bootTestApp, createTestUser, createMonicaAccount } from "./helpers.ts";
import { startFakeMonica } from "./fake-monica-api.ts";
import { createApiToken } from "../src/auth/tokens.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

describe("Metrics", () => {
  test("counts calls, errors, and percentiles; stays anonymous", () => {
    const m = new Metrics();
    m.recordCall("list_contacts", 10, true);
    m.recordCall("list_contacts", 30, true);
    m.recordCall("create_note", 50, false);
    const snap = m.snapshot({ monicaAccounts: 2, users: 2 });
    expect(snap.callsTotal).toBe(3);
    expect(snap.errorsTotal).toBe(1);
    expect(snap.callsLastMin).toBe(3);
    expect(snap.latency.p50).toBeGreaterThan(0);
    expect(snap.topTools[0]).toEqual({ tool: "list_contacts", count: 2 });
    // snapshot must not carry any per-user/account identifiers
    // (the `users` gauge is an aggregate count, which is allowed)
    const json = JSON.stringify(snap);
    expect(json).not.toContain("user_id");
    expect(json).not.toContain("token");
    expect(json).not.toContain("base_url");
  });

  test("persisted totals round-trip", () => {
    const m = new Metrics();
    m.recordCall("x", 5, true);
    const m2 = new Metrics();
    m2.load(m.persisted());
    expect(m2.snapshot({ monicaAccounts: 0, users: 0 }).callsTotal).toBe(1);
  });
});

describe("public status surface", () => {
  test("/status/json is open and aggregate; reflects a real call", async () => {
    const app = await bootTestApp();
    const monica = startFakeMonica();
    try {
      const userA = createTestUser(app.db, "Alice");
      createMonicaAccount(app.db, app.config.masterKey, userA, monica.url, "TOK-A-aaaa");
      const token = createApiToken(app.db, userA, "cli").token;

      const client = new Client({ name: "t", version: "0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${app.baseUrl}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      await client.callTool({ name: "me" });
      await client.close();

      const res = await fetch(`${app.baseUrl}/status/json`);
      expect(res.status).toBe(200);
      const snap = (await res.json()) as {
        callsTotal: number;
        recent: { tool: string }[];
        gauges: { monicaAccounts: number };
      };
      expect(snap.callsTotal).toBeGreaterThanOrEqual(1);
      expect(snap.gauges.monicaAccounts).toBe(1);
      expect(snap.recent.some((e) => e.tool === "me")).toBe(true);
    } finally {
      monica.close();
      await app.close();
    }
  });

  test("landing page renders without auth", async () => {
    const app = await bootTestApp();
    try {
      const res = await fetch(`${app.baseUrl}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("live status");
      expect(html).toContain("/status/stream");
    } finally {
      await app.close();
    }
  });
});
