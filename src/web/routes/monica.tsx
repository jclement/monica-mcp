import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { Layout, Card, ago } from "../layout.tsx";
import type { AuthEnv } from "../../auth/middleware.ts";
import type { AppRuntime } from "../../mcp/runtime.ts";
import type { Config } from "../../config.ts";
import {
  AccountError,
  deleteAccount,
  getAccount,
  openAccountToken,
  upsertAccount,
  type AccountRow,
  type TokenType,
} from "../../monica/account.ts";
import { MonicaClient, MonicaApiError } from "../../monica/client.ts";
import { recordAdmin } from "../../audit.ts";

function ConnectForm(props: { defaultBaseUrl: string; error?: string }) {
  return (
    <form
      hx-post="/app/monica"
      hx-target="#monica-card"
      hx-swap="innerHTML"
      class="grid grid-cols-1 gap-3"
    >
      {props.error ? <p class="text-sm text-danger">{props.error}</p> : null}
      <label class="text-sm text-text-muted">
        Monica instance URL
        <input
          name="baseUrl"
          required
          value={props.defaultBaseUrl}
          placeholder="https://app.monicahq.com"
          class="mt-1 w-full rounded-md border border-base-600 bg-base-800 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
      </label>
      <label class="text-sm text-text-muted">
        API token
        <input
          name="token"
          required
          type="password"
          placeholder="Monica personal access token"
          class="mt-1 w-full rounded-md border border-base-600 bg-base-800 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
      </label>
      <div>
        <button type="submit" class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
          Connect Monica
        </button>
      </div>
      <p class="text-xs text-text-muted">
        Create a token in Monica under Settings → API. It's encrypted at rest with the server master key and never shown
        again.
      </p>
    </form>
  );
}

function ConnectedCard(props: { account: AccountRow; defaultBaseUrl: string }) {
  const a = props.account;
  return (
    <div class="space-y-4">
      <dl class="grid grid-cols-2 gap-y-2 text-sm">
        <dt class="text-text-muted">Instance</dt>
        <dd class="font-mono">{a.base_url}</dd>
        <dt class="text-text-muted">Token</dt>
        <dd class="font-mono text-text-muted">…{a.token_last4 ?? "????"}</dd>
        <dt class="text-text-muted">Last used</dt>
        <dd class="text-text-muted">{ago(a.last_used_at)}</dd>
      </dl>
      <div class="flex flex-wrap items-center gap-3">
        <button
          hx-post="/app/monica/test"
          hx-target="#monica-test"
          hx-swap="innerHTML"
          class="rounded-md border border-base-600 px-3 py-1.5 text-sm hover:bg-base-800"
        >
          Test connection
        </button>
        <button
          hx-delete="/app/monica"
          hx-confirm="Disconnect your Monica account? The stored API token is erased."
          hx-target="#monica-card"
          hx-swap="innerHTML"
          class="text-sm text-danger hover:underline"
        >
          Disconnect
        </button>
        <span id="monica-test" class="text-sm text-text-muted"></span>
      </div>
      <details class="text-sm">
        <summary class="cursor-pointer text-text-muted hover:text-text">Rotate token / change instance</summary>
        <div class="mt-3">
          <ConnectForm defaultBaseUrl={a.base_url || props.defaultBaseUrl} />
        </div>
      </details>
    </div>
  );
}

/** Inner card body — swapped in place by HTMX after connect/disconnect. */
function MonicaCardBody(props: { account: AccountRow | null; defaultBaseUrl: string; error?: string }) {
  return props.account ? (
    <ConnectedCard account={props.account} defaultBaseUrl={props.defaultBaseUrl} />
  ) : (
    <ConnectForm defaultBaseUrl={props.defaultBaseUrl} error={props.error} />
  );
}

function MonicaPage(props: { account: AccountRow | null; defaultBaseUrl: string }) {
  return (
    <Layout title="Monica" activeNav="/app/monica">
      <div class="space-y-6">
        <h1 class="text-xl font-semibold">Your Monica account</h1>
        <Card title={props.account ? "Connected" : "Connect Monica"}>
          <div id="monica-card">
            <MonicaCardBody account={props.account} defaultBaseUrl={props.defaultBaseUrl} />
          </div>
        </Card>
        <p class="text-xs text-text-muted">
          Agents reach your Monica data through this server's <span class="font-mono">/mcp</span> endpoint. Every call uses
          your own token; no one else can see your account.
        </p>
      </div>
    </Layout>
  );
}

export function monicaRouter(db: Database, runtime: AppRuntime, config: Config): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const key = runtime.masterKey;
  const defaultBaseUrl = config.monicaDefaultBaseUrl;

  app.get("/", (c) => {
    const userId = c.var.session!.user_id;
    return c.html(<MonicaPage account={getAccount(db, userId)} defaultBaseUrl={defaultBaseUrl} />);
  });

  app.post("/", async (c) => {
    const userId = c.var.session!.user_id;
    const body = await c.req.parseBody();
    try {
      const account = upsertAccount(db, key, userId, {
        baseUrl: String(body.baseUrl ?? ""),
        token: String(body.token ?? ""),
        tokenType: String(body.tokenType ?? "") || undefined,
      });
      recordAdmin(db, userId, "monica.connect", { target: account.base_url });
      return c.html(<MonicaCardBody account={account} defaultBaseUrl={defaultBaseUrl} />);
    } catch (err) {
      if (err instanceof AccountError) {
        return c.html(<MonicaCardBody account={getAccount(db, userId)} defaultBaseUrl={defaultBaseUrl} error={err.message} />);
      }
      throw err;
    }
  });

  app.post("/test", async (c) => {
    const userId = c.var.session!.user_id;
    const account = getAccount(db, userId);
    if (!account) return c.html(<span class="text-danger">Not connected.</span>);
    try {
      const token = openAccountToken(db, key, userId)!;
      const client = new MonicaClient(account.base_url, token, account.token_type as TokenType);
      const me = (await client.request("GET", "/me")) as { data?: { first_name?: string; name?: string } };
      const name = me?.data?.name ?? me?.data?.first_name ?? "your account";
      return c.html(<span class="text-success">OK — connected as {name}.</span>);
    } catch (err) {
      const msg = err instanceof MonicaApiError ? err.message : err instanceof Error ? err.message : String(err);
      return c.html(<span class="text-danger">Failed: {msg}</span>);
    }
  });

  app.delete("/", (c) => {
    const userId = c.var.session!.user_id;
    if (deleteAccount(db, userId)) recordAdmin(db, userId, "monica.disconnect", {});
    return c.html(<MonicaCardBody account={null} defaultBaseUrl={defaultBaseUrl} />);
  });

  return app;
}
