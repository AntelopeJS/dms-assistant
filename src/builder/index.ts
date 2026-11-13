import { ImplementInterface } from "@antelopejs/interface-core";
import {
  type DmsBuilderConfig,
  isBuilderEnabled,
  setModuleConfig,
} from "./config";

export type { BuilderApiConfig, DmsBuilderConfig } from "./config";

/**
 * Install the implementation and, when the builder is enabled, mount the API:
 * the routes controller registers its routes as it is decorated, so importing
 * it is what mounts them.
 */
export async function construct(config?: DmsBuilderConfig): Promise<void> {
  setModuleConfig(config);
  void ImplementInterface(
    await import("@antelopejs/interface-dms-builder"),
    await import("./implementations/dms-builder"),
  );
  if (await isBuilderEnabled()) {
    await import("./routes");
  }
}
