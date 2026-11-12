/** Where a working login comes from. `env` always wins and cannot be changed from the UI. */
export type LoginSource = "env" | "saved" | "claude-cli" | "chatgpt";

/** One provider's login as the sidecar sees it. */
export type ProviderLogin =
  | { status: "signed-out" }
  | { status: "signed-in"; source: LoginSource; email?: string; plan?: string }
  | { status: "expired"; source: LoginSource; email?: string };
