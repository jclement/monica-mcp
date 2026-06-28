import type { TokenType } from "./account.ts";

/** Error from a Monica REST call, carrying the HTTP status and any error body. */
export class MonicaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
}

/**
 * Thin REST client for a single Monica instance, bound to one user's credentials.
 * Constructed per request from the decrypted account token — it is never shared
 * across users, which keeps the tenant-isolation guarantee at the HTTP layer.
 */
export class MonicaClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private tokenType: TokenType = "bearer",
  ) {}

  private authHeaders(): Record<string, string> {
    switch (this.tokenType) {
      case "apiKey":
        return { "X-API-Key": this.token };
      case "legacy":
        return { "X-MONICA-USER-TOKEN": this.token };
      case "bearer":
      default:
        return { Authorization: `Bearer ${this.token}` };
    }
  }

  /** Issue a request against `<baseUrl>/api<path>` and return the parsed JSON body. */
  async request(method: string, path: string, opts: RequestOptions = {}): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/api${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Accept: "application/json", ...this.authHeaders() };
    let payload: string | undefined;
    if (opts.body !== undefined && method !== "GET" && method !== "DELETE") {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: payload });
    } catch (err) {
      throw new MonicaApiError(0, `Could not reach Monica at ${this.baseUrl}: ${err instanceof Error ? err.message : err}`);
    }

    if (res.status === 429) {
      const reset = res.headers.get("X-RateLimit-Remaining");
      throw new MonicaApiError(429, `Monica rate limit hit (60 req/min). Remaining: ${reset ?? "0"}. Retry shortly.`);
    }

    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }

    if (!res.ok) {
      const msg = monicaErrorMessage(json) ?? `${res.status} ${res.statusText}`;
      throw new MonicaApiError(res.status, msg);
    }
    return json;
  }
}

/** Pull a human-usable message out of Monica's error envelope. */
function monicaErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return typeof json === "string" ? json : null;
  const obj = json as Record<string, unknown>;
  const err = obj.error;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (e.error_code !== undefined) return `error ${String(e.error_code)}`;
  }
  if (typeof obj.message === "string") return obj.message;
  return null;
}
