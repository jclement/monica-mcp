import { randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import { loadConfig, type Config } from "../src/config.ts";
import { openDatabase } from "../src/db/index.ts";
import type { AppRuntime } from "../src/mcp/runtime.ts";
import { upsertAccount } from "../src/monica/account.ts";
import { Metrics } from "../src/metrics.ts";
import { createApp } from "../src/app.tsx";

/** A 32-byte master key fixed across a test run. */
export const TEST_MASTER_KEY = randomBytes(32).toString("base64");

export function testConfig(): Config {
  return loadConfig({
    PUBLIC_URL: "http://localhost:3000",
    MASTER_KEY: TEST_MASTER_KEY,
    DATA_DIR: "/tmp/monica-mcp-test",
  } as unknown as NodeJS.ProcessEnv);
}

export interface TestApp {
  db: Database;
  config: Config;
  runtime: AppRuntime;
  metrics: Metrics;
  server: ReturnType<typeof Bun.serve>;
  baseUrl: string;
  close(): Promise<void>;
}

export async function bootTestApp(): Promise<TestApp> {
  const config = testConfig();
  const db = openDatabase(":memory:");
  const metrics = new Metrics();
  const runtime: AppRuntime = { masterKey: config.masterKey };
  const app = createApp({ config, db, runtime, metrics });
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 30 });
  return {
    db,
    config,
    runtime,
    metrics,
    server,
    baseUrl: `http://localhost:${server.port}`,
    close: async () => {
      server.stop(true);
      db.close();
    },
  };
}

/** Insert a user directly (bypassing the WebAuthn ceremony) for test setup. */
export function createTestUser(db: Database, displayName: string): number {
  const res = db
    .query("INSERT INTO users (display_name, user_handle) VALUES (?, ?)")
    .run(displayName, randomBytes(16));
  return Number(res.lastInsertRowid);
}

/** Connect a Monica account for a user, pointing at a (fake) instance URL. */
export function createMonicaAccount(db: Database, key: Buffer, userId: number, baseUrl: string, token: string) {
  return upsertAccount(db, key, userId, { baseUrl, token });
}
