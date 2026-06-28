import type { Database } from "bun:sqlite";
import { openPat, patLast4, sealPat } from "../crypto.ts";

/** Public view of a user's Monica account — never includes token material. */
export interface AccountRow {
  user_id: number;
  base_url: string;
  token_type: string;
  token_last4: string | null;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

interface SecretRow extends AccountRow {
  token_ciphertext: Uint8Array;
  token_nonce: Uint8Array;
  token_tag: Uint8Array;
}

const PUBLIC_COLS = "user_id, base_url, token_type, token_last4, created_at, updated_at, last_used_at";

/** Token types Monica accepts. `bearer` is the default for personal access tokens. */
export const TOKEN_TYPES = ["bearer", "apiKey", "legacy"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

export class AccountError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Normalize a user-entered Monica base URL into an origin we can append `/api` to.
 * Accepts an instance root (`https://app.monicahq.com`) or one with a `/api` suffix
 * and strips it. Requires https except on localhost (matches the WebAuthn rule);
 * `allowInsecureHttp` (MONICA_ALLOW_INSECURE_HTTP) lifts that to any host.
 */
export function normalizeBaseUrl(raw: string, allowInsecureHttp = false): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new AccountError("INVALID_URL", "Monica base URL is required.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AccountError("INVALID_URL", "Monica base URL must be a valid URL, e.g. https://app.monicahq.com.");
  }
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const httpOk = url.protocol === "http:" && (isLocalhost || allowInsecureHttp);
  if (url.protocol !== "https:" && !httpOk) {
    throw new AccountError("INVALID_URL", "Monica base URL must be https:// (http allowed only on localhost, or set MONICA_ALLOW_INSECURE_HTTP=1).");
  }
  // Drop a trailing `/api` (the client adds it) and any trailing slash, keeping any
  // sub-path so self-hosted installs under a prefix still work.
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/api$/i, "");
  return `${url.origin}${path}`;
}

export interface NewAccount {
  baseUrl: string;
  token: string;
  tokenType?: string;
}

export function getAccount(db: Database, userId: number): AccountRow | null {
  return db
    .query<AccountRow, [number]>(`SELECT ${PUBLIC_COLS} FROM monica_accounts WHERE user_id = ?`)
    .get(userId);
}

/** Create or replace this user's single Monica account. Returns the public row. */
export function upsertAccount(
  db: Database,
  key: Buffer,
  userId: number,
  input: NewAccount,
  allowInsecureHttp = false,
): AccountRow {
  const baseUrl = normalizeBaseUrl(input.baseUrl, allowInsecureHttp);
  const token = input.token.trim();
  if (!token) throw new AccountError("INVALID_TOKEN", "API token is required.");
  const tokenType = (input.tokenType?.trim() || "bearer") as TokenType;
  if (!TOKEN_TYPES.includes(tokenType)) throw new AccountError("INVALID_TOKEN_TYPE", "Unknown token type.");
  const sealed = sealPat(key, token);
  db.query(
    `INSERT INTO monica_accounts (user_id, base_url, token_type, token_ciphertext, token_nonce, token_tag, token_last4)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       base_url = excluded.base_url,
       token_type = excluded.token_type,
       token_ciphertext = excluded.token_ciphertext,
       token_nonce = excluded.token_nonce,
       token_tag = excluded.token_tag,
       token_last4 = excluded.token_last4,
       updated_at = unixepoch()`,
  ).run(userId, baseUrl, tokenType, sealed.ciphertext, sealed.nonce, sealed.tag, patLast4(token));
  return getAccount(db, userId)!;
}

/** Decrypt the API token for a user's account. Caller must already be the owner. */
export function openAccountToken(db: Database, key: Buffer, userId: number): string | null {
  const row = db
    .query<SecretRow, [number]>("SELECT * FROM monica_accounts WHERE user_id = ?")
    .get(userId);
  if (!row) return null;
  return openPat(key, {
    ciphertext: Buffer.from(row.token_ciphertext),
    nonce: Buffer.from(row.token_nonce),
    tag: Buffer.from(row.token_tag),
  });
}

export function deleteAccount(db: Database, userId: number): boolean {
  return db.query("DELETE FROM monica_accounts WHERE user_id = ?").run(userId).changes > 0;
}

export function touchAccount(db: Database, userId: number) {
  db.query("UPDATE monica_accounts SET last_used_at = unixepoch() WHERE user_id = ?").run(userId);
}

export function countAccounts(db: Database): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM monica_accounts").get()!.n;
}
