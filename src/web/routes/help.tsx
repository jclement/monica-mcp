import { Layout, Card } from "../layout.tsx";

/**
 * Public help / "what is this" page. Renders with the full app nav when the
 * visitor has a session, and with a lightweight sign-in header when they don't —
 * so the same explanation is reachable logged in or out.
 */
export function HelpPage(props: { loggedIn: boolean; userName?: string }) {
  return (
    <Layout title="Help" activeNav="/help" nav={props.loggedIn} userName={props.userName}>
      <div class={props.loggedIn ? "" : "mx-auto max-w-3xl px-6 py-10"}>
        {!props.loggedIn ? <PublicHeader /> : null}

        <div class="space-y-6">
          <div>
            <h1 class="text-2xl font-semibold">What is this?</h1>
            <p class="mt-3 text-sm leading-relaxed text-text-muted">
              This is a self-hosted gateway that puts <strong class="text-text">Monica</strong>, the{" "}
              <a href="https://www.monicahq.com" class="text-accent hover:underline">open-source personal CRM</a>, in
              front of your AI tools. Monica has a REST API but no shared, authenticated way for an assistant to reach
              it. This service wraps that API and exposes it as a proper{" "}
              <strong class="text-text">authenticated endpoint on the internet</strong> that many people can share —
              each connecting their own private Monica account.
            </p>
          </div>

          <Card title="What it does">
            <ul class="space-y-2 text-sm text-text-muted">
              <li>
                • Gives every user their own <strong class="text-text">isolated</strong> Monica account — your token is
                never reachable by anyone else.
              </li>
              <li>
                • Speaks the <span class="font-mono">Model Context Protocol</span> (MCP), so MCP-aware clients like
                Claude can work with your Monica data (contacts, notes, activities, reminders, tasks, and more).
              </li>
              <li>
                • Stores your Monica <strong class="text-text">API token encrypted at rest</strong> and decrypts it only
                to talk to Monica on your behalf.
              </li>
              <li>
                • Keeps an <strong class="text-text">audit log</strong> of the calls made through your account.
              </li>
            </ul>
          </Card>

          <Card title="Getting started">
            <ol class="space-y-3 text-sm text-text-muted">
              <li>
                <span class="font-medium text-text">1. Create an account.</span> Registration is open — sign up with a{" "}
                <strong class="text-text">passkey</strong> (Touch ID, Windows Hello, a security key, or your phone). No
                password to remember or leak.
              </li>
              <li>
                <span class="font-medium text-text">2. Connect Monica.</span> Under{" "}
                {props.loggedIn ? (
                  <a href="/app/monica" class="text-accent hover:underline">Monica</a>
                ) : (
                  "Monica"
                )}
                , give it your <strong class="text-text">instance URL</strong> (the hosted{" "}
                <span class="font-mono">app.monicahq.com</span> or your self-hosted URL) and an{" "}
                <strong class="text-text">API token</strong> (Monica → Settings → API).
              </li>
              <li>
                <span class="font-medium text-text">3. Connect your MCP client.</span> Two ways:
                <ul class="mt-2 ml-4 space-y-1">
                  <li>
                    • <strong class="text-text">OAuth</strong> — clients that support remote MCP (e.g. Claude) just
                    point at the endpoint and you authorize with your passkey.
                  </li>
                  <li>
                    • <strong class="text-text">API token</strong> — create one under{" "}
                    {props.loggedIn ? (
                      <a href="/app/tokens" class="text-accent hover:underline">Tokens</a>
                    ) : (
                      "Tokens"
                    )}{" "}
                    and send it as <span class="font-mono">Authorization: Bearer &lt;token&gt;</span>.
                  </li>
                </ul>
              </li>
              <li>
                <span class="font-medium text-text">4. Discover tools.</span> Call <span class="font-mono">me</span> to
                confirm the connection, then <span class="font-mono">search_contacts</span> /{" "}
                <span class="font-mono">list_contacts</span> and the per-resource tools.
              </li>
            </ol>
          </Card>

          <Card title="About your credentials">
            <p class="text-sm leading-relaxed text-text-muted">
              Your Monica API token is encrypted at rest and scoped to your account alone. Still, this is a personal,
              best-effort project, not a professionally operated service — so revoke the token in Monica the moment you
              stop using it. Full details are in the{" "}
              <a href="/privacy" class="text-accent hover:underline">privacy &amp; disclaimer</a>.
            </p>
          </Card>

          <Card title="Run your own">
            <p class="text-sm leading-relaxed text-text-muted">
              Don't want to trust someone else's server with your Monica token? Fair. The whole thing is open source and
              ships as a single self-hosted container — clone it and run your own instance:
            </p>
            <p class="mt-3">
              <a href="https://github.com/jclement/monica-mcp" class="font-mono text-sm text-accent hover:underline">
                github.com/jclement/monica-mcp
              </a>
            </p>
          </Card>

          {!props.loggedIn ? (
            <div class="flex items-center gap-3 pt-2">
              <a href="/register" class="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover">
                Get started
              </a>
              <a href="/login" class="rounded-md border border-base-600 px-4 py-2 hover:bg-base-800">
                Sign in
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}

function PublicHeader() {
  return (
    <header class="mb-10 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3">
        <img src="/assets/logo.svg" alt="" class="h-8 w-8" />
        <span class="font-semibold">Monica MCP</span>
      </a>
      <div class="flex items-center gap-3 text-sm">
        <a href="/login" class="rounded-md border border-base-600 px-3 py-1.5 hover:bg-base-800">Sign in</a>
        <a href="/register" class="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover">Get started</a>
      </div>
    </header>
  );
}
