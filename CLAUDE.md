# CLAUDE.md

Guidance for working in this repo. Read this before making changes.

## What this is

A self-hosted, single-container **multi-user** gateway that exposes
[Monica](https://www.monicahq.com) (an open-source personal CRM) to AI agents
over an authenticated remote MCP endpoint. It adds passkey auth (people), OAuth
2.1 + API tokens (agents), a per-user Monica account (instance URL + API token,
encrypted at rest), an audit log, and a public status page. Monica's tools are
implemented **natively** against its REST API — there are no child processes.
Runtime is **Bun + TypeScript + Hono**; UI is **server-rendered Hono JSX + HTMX +
Tailwind v4**; state is **bun:sqlite**.

## Commands

`mise run dev` (hot reload), `mise run test` (`bun test`), `mise run typecheck`
(`tsc --noEmit`), `mise run build`, `mise run docker:build`. Direct: `bun test`,
`bun test test/isolation.integration.test.ts`. **Run `bunx tsc --noEmit` and
`bun test` before committing.** Dev needs `MASTER_KEY` set (or it uses a
throwaway key and warns).

## The core invariant

Monica is a plain REST API (`Authorization: Bearer <token>`, base URL like
`https://app.monicahq.com` or a self-hosted instance). Each user connects **one**
Monica account. **A user's token must never be reachable by another user** — this
is the invariant the whole design protects. The MCP server is built per request,
bound to one `userId`, and resolves the account only via `WHERE user_id = ?`. If
you touch routing, auth, or the Monica server, keep
`test/isolation.integration.test.ts` green.

## Architecture (`src/`)

- `server.ts` — boot: config → migrate DB → build `AppRuntime` → `Bun.serve` →
  SIGTERM (flush metrics, close db). `app.tsx` — Hono wiring, middleware order,
  `/mcp` endpoint.
- `config.ts` — env parsing incl. `MASTER_KEY`, `MONICA_DEFAULT_BASE_URL`.
  `crypto.ts` — AES-256-GCM seal/open for tokens.
- `auth/` — `webauthn.ts` (multi-user passkeys; register creates a new user,
  login resolves the owner), `sessions.ts`, `tokens.ts` (static + OAuth bearer,
  `AuthPrincipal.userId` is the tenant), `middleware.ts`.
- `oauth/` — hand-rolled OAuth 2.1 AS; clients are global, **consent + grants are
  per-user** (`oauth_consents`, `oauth_grants.user_id`).
- `monica/` — `account.ts` (single-account CRUD; token seal/open; **every query
  scoped to `user_id`**), `client.ts` (REST client over `fetch`), `tools.ts`
  (declarative tool registry — CRUD generated per resource + hand-written
  specials), `server.ts` (per-user `Server`; the tenant-isolation chokepoint in
  `tools/call`).
- `mcp/` — `respond.ts` (`ok`/`fail`/`firstText`), `runtime.ts` (`AppRuntime`).
- `web/` — `layout.tsx`, `origin.ts`, `routes/*.tsx` (register, login, dashboard,
  monica, tokens, clients, activity, account, consent). All scoped to
  `c.var.session!.user_id`.
- `db/` — `index.ts` (open + numbered migrations + settings KV),
  `migrations/0001_init.sql` (users, auth, OAuth, `monica_accounts`, audit log).

## Conventions

- **Tenant scoping is non-negotiable.** Any new query touching user data takes a
  `userId` and filters by it. Any new MCP tool must resolve the Monica account
  only via the authenticated `userId`.
- **Token hygiene:** never log or persist a plaintext token; decrypt only at call
  time in `monica/server.ts`.
- **Schema changes** are new numbered migrations in `src/db/migrations/` — never
  edit an applied one. Simple config goes in the `settings` KV via
  `getSetting`/`setSetting`.
- **UI:** Hono JSX SSR + HTMX (vendored in `public/vendor/`, no CDN). If you add
  or change Tailwind classes, rebuild CSS (`bunx @tailwindcss/cli -i styles/app.css
  -o public/app.css`) — `public/app.css` is a gitignored build artifact.
- **Imports:** ESM with explicit `.ts`/`.tsx` extensions; JSX files are `.tsx`.
- **Tests:** `bun:test`. Use `test/helpers.ts` (`bootTestApp`, `createTestUser`,
  `createMonicaAccount`) and `test/fake-monica-api.ts` (a stand-in HTTP server
  that echoes the bearer token it received) so no real instance/token is needed.

## Monica coupling

Monica is 0.x and its REST shapes can drift. Create/update tools accept a generic
`data` object so callers pass Monica's field set directly; resource paths and the
hand-written specials (`search_contacts`, `set_contact_tags`, conversation
messages, `me`) live in `src/monica/tools.ts`. The REST client and error mapping
(incl. the 60 req/min rate limit) live in `src/monica/client.ts`.

## Gotchas

- Env vars are read at boot; `bun --watch` reloads code but not env — restart
  `mise run dev` to change them.
- Losing `MASTER_KEY` makes all stored tokens unrecoverable. Rotating it requires
  re-encrypting every `monica_accounts` row.
- Registration is open by design (no admin). The network boundary is the
  perimeter; don't add an admin concept without a reason.
