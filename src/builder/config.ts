import path from "node:path";
import { GetRuntimeInfo } from "@antelopejs/interface-core/runtime";
import { builderEnabled } from "./frontend-module";

/** The external-database routes the onboarding calls. */
export interface BuilderApiConfig {
  /**
   * Force the builder on or off. Unset, it follows the project's development
   * mode: on under `ajs project run` (with or without `-w`), off under
   * `ajs project start`, which runs a build.
   */
  enabled?: boolean;
}

/** The module's `builder` key. */
export interface DmsBuilderConfig {
  api?: BuilderApiConfig;
}

let moduleConfig: DmsBuilderConfig = {};
let enabled: Promise<boolean> | undefined;

export function setModuleConfig(config?: DmsBuilderConfig): void {
  moduleConfig = config ?? {};
  enabled = undefined;
}

async function resolveEnabled(): Promise<boolean> {
  const { dev } = await GetRuntimeInfo();
  return builderEnabled(moduleConfig, dev);
}

/**
 * Whether the builder — its HTTP API and its frontend module alike — is
 * available in this process.
 *
 * The routes rewrite the app's TypeScript sources through `@antelopejs/dms`,
 * and those exist only in a development checkout, so the core's own
 * development flag decides: the same
 * one the DMS uses for dev reload and for its `.antelope/dms-dev.json`
 * handshake. `NODE_ENV` is deliberately not consulted — nothing sets it on the
 * way to `ajs project start`, so a production deployment would have kept the
 * builder mounted. An explicit `api.enabled` overrides the default either way,
 * for an operator who really does want the builder on a running deployment.
 *
 * Memoized: the answer cannot change within a process, and both `construct()`
 * and `start()` ask.
 */
export function isBuilderEnabled(): Promise<boolean> {
  enabled ??= resolveEnabled();
  return enabled;
}

/** The `.env` of the project, the file the core loads at start and watches under `ajs project dev -w`. */
export async function projectEnvFile(): Promise<string> {
  const { projectPath } = await GetRuntimeInfo();
  return path.join(path.resolve(projectPath), ".env");
}
