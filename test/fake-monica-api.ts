/**
 * A tiny HTTP server used in tests in place of a real Monica instance. It echoes
 * the bearer token it received (as a 4-char tail) so the isolation tests can
 * prove that a user's request reaches Monica carrying *that user's* token and no
 * other.
 *
 * It serves Monica-shaped responses under `/api/*`. `tokensSeen` records every
 * token tail it has been called with, in order.
 */
export interface FakeMonica {
  url: string;
  tokensSeen: string[];
  close(): void;
}

function tail(token: string): string {
  return token.slice(-4);
}

export function startFakeMonica(): FakeMonica {
  const tokensSeen: string[] = [];
  const server = Bun.serve({
    port: 0,
    idleTimeout: 30,
    async fetch(req) {
      const auth = req.headers.get("authorization") ?? "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (!token) return Response.json({ error: { message: "unauthenticated" } }, { status: 401 });
      const t = tail(token);
      tokensSeen.push(t);

      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/api/, "");
      let body: unknown = undefined;
      if (req.method !== "GET" && req.method !== "DELETE") {
        try {
          body = await req.json();
        } catch {
          body = undefined;
        }
      }

      if (path === "/me") {
        return Response.json({ data: { id: 1, name: `User ${t}`, tokenTail: t } });
      }
      if (path === "/contacts") {
        return Response.json({ data: [], meta: { total: 0 }, tokenTail: t, method: req.method, body });
      }
      // generic echo for any other resource path
      return Response.json({ data: { ok: true }, tokenTail: t, path, method: req.method, body });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    tokensSeen,
    close: () => server.stop(true),
  };
}
