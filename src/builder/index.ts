import {
  type DmsBuilderConfig,
  isBuilderEnabled,
  setModuleConfig,
} from "./config";
import { beginRun } from "./run";

export type { BuilderApiConfig, DmsBuilderConfig } from "./config";

/**
 * Mounts the external-database API when the builder is enabled: the routes
 * controller registers its routes as it is decorated, so importing it is what
 * mounts them.
 */
export async function construct(config?: DmsBuilderConfig): Promise<void> {
  beginRun();
  setModuleConfig(config);
  if (!(await isBuilderEnabled())) return;
  await import("./routes");
}
