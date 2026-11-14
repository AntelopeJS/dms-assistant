import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MOCK_CODEX_NODE_ENV } from "../../src/constants/codex.js";

const CODEX_NAMED_NODE = "codex.exe";

/**
 * On Windows, where the sidecar recognizes an orphaned app-server by its image
 * name, runs the mock Codex with a copy of node named `codex.exe`, as the real
 * binary is named. Elsewhere the command line already names the mock's
 * script, and nothing changes. Returns its removal.
 */
export function useCodexNamedNode(): () => void {
  if (process.platform !== "win32") return () => {};
  const dir = mkdtempSync(path.join(tmpdir(), "dms-ai-codex-node-"));
  const node = path.join(dir, CODEX_NAMED_NODE);
  copyFileSync(process.execPath, node);
  process.env[MOCK_CODEX_NODE_ENV] = node;
  return () => {
    delete process.env[MOCK_CODEX_NODE_ENV];
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  };
}
