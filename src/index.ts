import { Logging } from "@antelopejs/interface-core/logging";
import { GetRuntimeInfo } from "@antelopejs/interface-core/runtime";
import { AddFrontendModule } from "@antelopejs/interface-dms/page";
import { construct as constructBuilder } from "./builder";
import { closeAllBridges } from "./channels/registry";
import { ConfigSchema, getConfig, setConfig } from "./config";
import { DEFAULT_BACKEND_URL } from "./constants/mcp";
import { SIDECAR_LOG_PREFIX } from "./constants/sidecar";
import { collectModuleRoots } from "./lifecycle/module-roots";
import { publishProjectMcp } from "./lifecycle/project-mcp";
import { collectSkillSources } from "./lifecycle/skill-sources";
import { isSidecarDisabled, spawnSidecar } from "./lifecycle/spawn-sidecar";
import { startLogCapture } from "./logging/log-buffer";
import "./pages";
import "./routes";
import { frontendModule } from "./frontend-module";

export type { AIConfig } from "./config";
export type { BuilderApiConfig, DmsBuilderConfig } from "./builder";

/**
 * Parses the project config, then constructs the builder: it installs the
 * `@antelopejs/interface-dms-builder` implementation and, when the builder is
 * on, mounts its HTTP API.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- core calls the published construct hook with the raw project config, so narrowing the parameter changes the published signature; ConfigSchema.safeParse parses it on the next line
export async function construct(config: unknown): Promise<void> {
  const parsed = ConfigSchema.safeParse(config).data ?? {};
  setConfig(parsed);
  await constructBuilder(parsed.builder);
}

/**
 * Spawns the sidecar from start(), not module load: by now every module is
 * loaded, so interface-core can report their on-disk roots and declared skills
 * authoritatively. The builder's operations ship in this module, so the
 * sidecar always has them for Safe mode.
 */
export async function start() {
  startLogCapture();
  const { dev } = await GetRuntimeInfo();
  await AddFrontendModule(frontendModule(getConfig(), { dev }));
  const hostProjectRoot = process.cwd();
  const [moduleRoots, skillDirs] = await Promise.all([
    collectModuleRoots(),
    collectSkillSources(hostProjectRoot),
  ]);
  const { mcpJson, builder: _builder, ...sidecarConfig } = getConfig();
  void spawnSidecar({
    hostProjectRoot,
    ...sidecarConfig,
    moduleRoots,
    skillDirs,
    builderEnabled: true,
  }).catch((err: unknown) => {
    Logging.Error(`${SIDECAR_LOG_PREFIX} spawn failed:`, err);
  });
  if (isSidecarDisabled()) return;
  await publishProjectMcp({
    hostProjectRoot,
    backendUrl: sidecarConfig.backendUrl ?? DEFAULT_BACKEND_URL,
    writeMcpJson: mcpJson !== false,
  }).catch((err: unknown) => {
    Logging.Error(`${SIDECAR_LOG_PREFIX} MCP publish failed:`, err);
  });
}

/**
 * Ends every browser stream and sidecar socket this instance bridged. A hot
 * reload replaces the module with a fresh copy, so anything left open here would
 * outlive it; the browser reconnects to the new instance on its own.
 */
export function destroy(): void {
  closeAllBridges();
}
