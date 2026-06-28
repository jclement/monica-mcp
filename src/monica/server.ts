import type { Database } from "bun:sqlite";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { AuthPrincipal } from "../auth/tokens.ts";
import { getAccount, openAccountToken, touchAccount } from "./account.ts";
import { MonicaClient, MonicaApiError } from "./client.ts";
import { MONICA_TOOLS, MONICA_TOOLS_BY_NAME } from "./tools.ts";
import { fail, ok } from "../mcp/respond.ts";
import type { TokenType } from "./account.ts";

export const SERVER_INSTRUCTIONS = `Monica CRM MCP server.

This server exposes your personal Monica CRM (https://www.monicahq.com) as MCP tools:
contacts, notes, activities, calls, conversations, reminders, tasks, tags, journal,
gifts, relationships and more. Each user connects ONE Monica account (instance URL +
API token) in the web UI; every call is made with your own token and you only ever see
your own data — credentials never cross between users.

Call \`me\` first to confirm connectivity, \`search_contacts\` / \`list_contacts\` to find
people, then the per-resource tools. Create/update tools take a \`data\` object matching
Monica's REST fields.`;

export interface MonicaServerDeps {
  db: Database;
  masterKey: Buffer;
  principal: AuthPrincipal;
  /** Audit/metrics hook: resource (null), tool name, args, result, duration ms. */
  onCall?: (resource: string | null, tool: string, args: Record<string, unknown>, result: CallToolResult, ms: number) => void;
}

const ADVERTISED: Tool[] = MONICA_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema as Tool["inputSchema"],
  annotations: t.readOnly ? { readOnlyHint: true } : undefined,
}));

/**
 * Build a per-user MCP server backed by the user's Monica account. Bound to exactly
 * one user — `deps.principal.userId` — and every account/token lookup is scoped to
 * that user, so there is no path from this server to another user's Monica token.
 */
export function createMonicaServer(deps: MonicaServerDeps): Server {
  const { db, masterKey, principal } = deps;
  const userId = principal.userId;

  const server = new Server(
    { name: "monica-mcp", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ADVERTISED }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const started = Date.now();
    const finish = (result: CallToolResult) => {
      deps.onCall?.(null, name, args, result, Date.now() - started);
      return result;
    };

    const tool = MONICA_TOOLS_BY_NAME.get(name);
    if (!tool) return finish(fail("UNKNOWN_TOOL", `No tool named '${name}'.`));

    // Tenant-isolation chokepoint: the account (and its token) is resolved ONLY for
    // the authenticated user. Another user's token is never reachable here.
    const account = getAccount(db, userId);
    if (!account) {
      return finish(fail("NO_ACCOUNT", "No Monica account connected. Add your instance URL and API token in the web UI."));
    }
    const token = openAccountToken(db, masterKey, userId);
    if (token == null) return finish(fail("NO_ACCOUNT", "Monica account could not be read."));

    const client = new MonicaClient(account.base_url, token, account.token_type as TokenType);
    try {
      const payload = await tool.handler(client, args);
      touchAccount(db, userId);
      return finish(ok(payload ?? { ok: true }));
    } catch (err) {
      if (err instanceof MonicaApiError) return finish(fail("MONICA_ERROR", err.message));
      return finish(fail("TOOL_ERROR", err instanceof Error ? err.message : String(err)));
    }
  });

  return server;
}
