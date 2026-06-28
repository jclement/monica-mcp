/** The shared state the /mcp endpoint and the UI need to talk to Monica. */
export interface AppRuntime {
  /** AES-256-GCM key that encrypts Monica API tokens at rest. */
  masterKey: Buffer;
}
