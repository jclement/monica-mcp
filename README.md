# Monica MCP (multi-user gateway)

A self-hosted, single-container service that exposes your
[Monica](https://www.monicahq.com) personal CRM to AI agents over an
**authenticated remote endpoint**. It handles auth (passkeys for people, OAuth
2.1 / API tokens for agents) and a **per-user Monica account** (instance URL +
API token), and implements Monica's tools natively against its REST API.

It is **multi-user with no admin**: anyone who can reach it self-registers and
connects their own Monica account. A user's token is never reachable by another
user.

## How it works

Monica is a plain REST API (`Authorization: Bearer <token>`, base URL like
`https://app.monicahq.com` or a self-hosted instance). So this gateway:

- stores **one Monica account per user** — the instance URL plus an API token
  encrypted at rest, decrypted only in memory at call time;
- fronts agents with a single `/mcp` endpoint (Streamable HTTP + bearer auth)
  that, per request, builds a server bound to exactly one authenticated user;
- implements Monica's resources (contacts, notes, activities, calls,
  conversations, reminders, tasks, tags, journal, gifts, relationships, and more)
  as native MCP tools that call the REST API with that user's token, and audits
  every call.

```
agent ──Bearer──▶ /mcp ──(user-scoped server)──▶ Monica REST API (userX token)
```

### The never-bleed guarantee

- Every bearer credential resolves to a `user_id`. The MCP server is built per
  request and bound to that one user.
- `tools/call` resolves the Monica account only via `WHERE user_id = ?`
  (`src/monica/server.ts`) — there is no code path from one user's request to
  another user's account or token.
- Tokens are encrypted at rest with AES-256-GCM under `MASTER_KEY`
  (`src/crypto.ts`), decrypted only in memory at call time, never logged.
- `test/isolation.integration.test.ts` boots the app with two users and proves a
  user's calls always carry their own token and never see another user's data.

## Live status wall

The root path `/` is a public, no-auth dashboard showing **aggregate, anonymous**
activity across all accounts: lifetime tool calls, calls/min, p50/p95 latency,
error rate, a 24-hour sparkline, connected accounts, and a live feed of recent
calls (generic tool names only — never users, contacts, URLs, args, or tokens).
It updates over SSE (`/status/stream`); `/status/json` is the snapshot.

Counters live in memory (`src/metrics.ts`), flush to the DB every 30s (lifetime
totals survive restarts), and push to connected browsers over SSE.

## Quick start (dev)

```sh
bun install
mise run dev   # http://localhost:3000
```

`mise run dev` sets `ALLOW_DEV_MASTER_KEY=1`, which opts into a built-in
`"DEVELOPMENT"` key so locally stored tokens survive restarts. **Any deployment
without `MASTER_KEY` and without that explicit flag refuses to boot** — so a
misconfigured server can never silently encrypt real tokens with the public dev
key.

Open `/register`, create a passkey, then connect your Monica account (instance
URL + API token) on the Monica page. Create an API token on the Tokens page and
point a client at it:

```sh
claude mcp add --transport http monica http://localhost:3000/mcp \
  --header "Authorization: Bearer <token>"
```

Ask the agent to call `me`, then `search_contacts` / `list_contacts` and the
per-resource tools.

## Deploy

Single container. Put it behind a TLS-terminating proxy/tunnel that sets
`X-Forwarded-Proto`/`X-Forwarded-Host` (passkeys need a secure origin). Sample composes in [`deploy/`](deploy/):

- [`docker-compose.yml`](deploy/docker-compose.yml) — direct (publishes port 3000)
- [`docker-compose.cloudflared.yml`](deploy/docker-compose.cloudflared.yml) — behind a Cloudflare Tunnel
- [`docker-compose.gatecrash.yml`](deploy/docker-compose.gatecrash.yml) — behind a self-hosted [Gatecrash](https://github.com/jclement/gatecrash) tunnel

> **Open registration:** anyone who can reach the URL can create an account.
> Tokens stay isolated per user, but the **network boundary is your real
> perimeter** — front it with a VPN / private ingress / Cloudflare Access.

> **Back up `MASTER_KEY`.** Losing it makes every stored Monica token unrecoverable.

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `MASTER_KEY` | (required) | 32-byte base64/hex key; encrypts Monica tokens at rest. Required unless `ALLOW_DEV_MASTER_KEY=1` |
| `ALLOW_DEV_MASTER_KEY` | `0` | Local dev only: opt into the built-in insecure key when `MASTER_KEY` is unset |
| `PUBLIC_URL` | unset (derive from proxy) | Hard-pin the public origin/rpID |
| `PORT` | `3000` | Listen port |
| `MONICA_DEFAULT_BASE_URL` | `https://app.monicahq.com` | Pre-fills the "connect Monica" form |
| `AUTH_RESET` | `0` | Wipe all passkeys + sessions on boot |

## Development

```sh
mise run test        # bun test
mise run typecheck   # tsc --noEmit
mise run build       # CSS + bundle to dist/
mise run docker:build
```

Tests use `test/fake-monica-api.ts` — a tiny HTTP server that stands in for
Monica and echoes the bearer token it received, so no real instance/token is
needed.
