import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { Config } from "../../config.ts";
import { Layout, Card } from "../layout.tsx";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getAccount } from "../../monica/account.ts";
import { listApiTokens } from "../../auth/tokens.ts";
import { listUserOAuthClients } from "../../oauth/router.ts";
import { getUser } from "../../auth/webauthn.ts";

function Stat(props: { label: string; value: string | number; href: string }) {
  return (
    <a href={props.href} class="rounded-lg border border-base-700 bg-base-900 p-5 hover:border-base-600">
      <div class="text-2xl font-semibold">{props.value}</div>
      <div class="text-sm text-text-muted">{props.label}</div>
    </a>
  );
}

export function dashboardRouter(db: Database, _config: Config): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  app.get("/", (c) => {
    const userId = c.var.session!.user_id;
    const user = getUser(db, userId);
    const account = getAccount(db, userId);
    const tokens = listApiTokens(db, userId).filter((t) => !t.revoked_at);
    const clients = listUserOAuthClients(db, userId);
    return c.html(
      <Layout title="Dashboard" activeNav="/app" userName={user?.display_name}>
        <div class="space-y-6">
          <h1 class="text-xl font-semibold">Welcome{user ? `, ${user.display_name}` : ""}</h1>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Monica account" value={account ? "Connected" : "Not connected"} href="/app/monica" />
            <Stat label="API tokens" value={tokens.length} href="/app/tokens" />
            <Stat label="Connected clients" value={clients.length} href="/app/clients" />
          </div>
          <Card title="MCP endpoint">
            <p class="text-sm text-text-muted">
              Point your MCP client at <span class="font-mono">{c.var.publicOrigin}/mcp</span>. Your Monica tools
              (contacts, notes, activities, reminders, and more) are available directly — call{" "}
              <span class="font-mono">me</span> to confirm the connection.
            </p>
          </Card>
          {account ? null : (
            <Card title="Get started">
              <p class="text-sm text-text-muted">
                <a href="/app/monica" class="text-accent hover:underline">
                  Connect your Monica account
                </a>{" "}
                (instance URL + API token) to start using the tools.
              </p>
            </Card>
          )}
        </div>
      </Layout>,
    );
  });

  return app;
}
