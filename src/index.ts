import { Logging } from "@antelopejs/interface-core/logging";
import { Events } from "@antelopejs/interface-core/modules";
import { GetRuntimeInfo } from "@antelopejs/interface-core/runtime";
import { AddFrontendModule } from "@antelopejs/interface-dms/page";
import { construct as constructBuilder } from "./builder";
import { closeAllBridges } from "./channels/registry";
import { type AIConfig, ConfigSchema, getConfig, setConfig } from "./config";
import { SIDECAR_LOG_PREFIX } from "./constants/sidecar";
import { collectModuleRoots } from "./lifecycle/module-roots";
import { syncProjectMcpJson } from "./lifecycle/project-mcp-json";
import { closeReloadHost } from "./lifecycle/reload-host";
import { collectSkillSources } from "./lifecycle/skill-sources";
import { spawnSidecar } from "./lifecycle/spawn-sidecar";
import { startLogCapture } from "./logging/log-buffer";
import "./pages";
import "./routes";
import { frontendModule } from "./frontend-module";

export type { AIConfig } from "./config";
export type { BuilderApiConfig, DmsBuilderConfig } from "./builder";

export async function construct(config?: AIConfig): Promise<void> {
  const parsed = ConfigSchema.safeParse(config).data ?? {};
  setConfig(parsed);
  await constructBuilder(parsed.builder);
}

/**
 * Spawns the sidecar from start(), not module load: by now every module is
 * loaded, so interface-core can report their on-disk roots and declared skills
 * authoritatively.
 */
export async function start() {
  startLogCapture();
  const { dev, projectPath } = await GetRuntimeInfo();
  if (dev) {
    Events.ModulesStarted.register(() => {
      void syncProjectMcpJson(projectPath);
    });
  }
  await AddFrontendModule(frontendModule(getConfig(), { dev }));
  const hostProjectRoot = process.cwd();
  const [moduleRoots, skillDirs] = await Promise.all([
    collectModuleRoots(),
    collectSkillSources(hostProjectRoot),
  ]);
  const { builder: _builder, ...sidecarConfig } = getConfig();
  void spawnSidecar({
    hostProjectRoot,
    ...sidecarConfig,
    moduleRoots,
    skillDirs,
    builderEnabled: true,
  }).catch((err: unknown) => {
    Logging.Error(`${SIDECAR_LOG_PREFIX} spawn failed:`, err);
  });
}

/**
 * Ends every browser stream and sidecar socket this instance bridged. A hot
 * reload replaces the module with a fresh copy, so anything left open here would
 * outlive it; the browser reconnects to the new instance on its own.
 */
export async function destroy(): Promise<void> {
  closeAllBridges();
  await closeReloadHost();
}
