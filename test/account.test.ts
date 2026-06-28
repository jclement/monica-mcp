import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../src/db/index.ts";
import {
  AccountError,
  deleteAccount,
  getAccount,
  normalizeBaseUrl,
  openAccountToken,
  upsertAccount,
} from "../src/monica/account.ts";
import { createTestUser } from "./helpers.ts";

let db: Database;
const key = randomBytes(32);

beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());

describe("monica account store", () => {
  test("creates and reads an account, scoped to its user", () => {
    const a = createTestUser(db, "A");
    const b = createTestUser(db, "B");
    upsertAccount(db, key, a, { baseUrl: "https://app.monicahq.com", token: "TOK-A-1234" });
    expect(getAccount(db, a)?.base_url).toBe("https://app.monicahq.com");
    expect(getAccount(db, a)?.token_last4).toBe("1234");
    expect(getAccount(db, b)).toBeNull();
  });

  test("one account per user — upsert replaces in place", () => {
    const a = createTestUser(db, "A");
    upsertAccount(db, key, a, { baseUrl: "https://one.example.com", token: "first-tok" });
    upsertAccount(db, key, a, { baseUrl: "https://two.example.com", token: "second-tok" });
    expect(getAccount(db, a)?.base_url).toBe("https://two.example.com");
    expect(openAccountToken(db, key, a)).toBe("second-tok");
    const n = db.query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM monica_accounts WHERE user_id = ?").get(a)!.n;
    expect(n).toBe(1);
  });

  test("token decrypts only for the owning user", () => {
    const a = createTestUser(db, "A");
    const b = createTestUser(db, "B");
    upsertAccount(db, key, a, { baseUrl: "https://app.monicahq.com", token: "super-secret" });
    expect(openAccountToken(db, key, a)).toBe("super-secret");
    expect(openAccountToken(db, key, b)).toBeNull();
  });

  test("re-connecting bumps updated_at and re-encrypts", async () => {
    const a = createTestUser(db, "A");
    upsertAccount(db, key, a, { baseUrl: "https://app.monicahq.com", token: "old" });
    const before = getAccount(db, a)!.updated_at;
    await Bun.sleep(1100); // unixepoch has second resolution
    upsertAccount(db, key, a, { baseUrl: "https://app.monicahq.com", token: "new-tok" });
    expect(openAccountToken(db, key, a)).toBe("new-tok");
    expect(getAccount(db, a)!.updated_at).toBeGreaterThan(before);
  });

  test("delete is scoped to the user", () => {
    const a = createTestUser(db, "A");
    const b = createTestUser(db, "B");
    upsertAccount(db, key, a, { baseUrl: "https://app.monicahq.com", token: "x" });
    expect(deleteAccount(db, b)).toBe(false);
    expect(deleteAccount(db, a)).toBe(true);
    expect(getAccount(db, a)).toBeNull();
  });

  test("rejects empty token", () => {
    const a = createTestUser(db, "A");
    expect(() => upsertAccount(db, key, a, { baseUrl: "https://app.monicahq.com", token: "  " })).toThrow(AccountError);
  });
});

describe("base url normalization", () => {
  test("strips a trailing /api and trailing slashes", () => {
    expect(normalizeBaseUrl("https://app.monicahq.com/")).toBe("https://app.monicahq.com");
    expect(normalizeBaseUrl("https://app.monicahq.com/api")).toBe("https://app.monicahq.com");
    expect(normalizeBaseUrl("https://self.example.com/monica/api/")).toBe("https://self.example.com/monica");
  });

  test("requires https except on localhost", () => {
    expect(() => normalizeBaseUrl("http://app.monicahq.com")).toThrow(AccountError);
    expect(() => normalizeBaseUrl("not a url")).toThrow(AccountError);
    expect(normalizeBaseUrl("http://localhost:8080")).toBe("http://localhost:8080");
  });

  test("allowInsecureHttp permits http on any host", () => {
    expect(normalizeBaseUrl("http://monica.lan/api", true)).toBe("http://monica.lan");
    // still rejects garbage, and the malformed-url path is unaffected
    expect(() => normalizeBaseUrl("not a url", true)).toThrow(AccountError);
  });
});
