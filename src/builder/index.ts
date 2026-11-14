import {
  type DmsBuilderConfig,
  isBuilderEnabled,
  projectEnvFile,
  setModuleConfig,
} from "./config";
import { rememberLoadedEnv } from "./reload";

export type { BuilderApiConfig, DmsBuilderConfig } from "./config";

/**
 * Mounts the external-database API when the builder is enabled: the routes
 * controller registers its routes as it is decorated, so importing it is what
 * mounts them.
 */
export async function construct(config?: DmsBuilderConfig): Promise<void> {
  setModuleConfig(config);
  if (!(await isBuilderEnabled())) return;
  await rememberLoadedEnv(await projectEnvFile());
  await import("./routes");
}
