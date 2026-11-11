import type { AddFrontendModuleOptions } from "@antelopejs/interface-dms/page";
import type { DmsBuilderConfig } from "./config";
import {
  FRONTEND_MODULE_CONFIG_KEY,
  FRONTEND_MODULE_ENABLED_OPTION,
} from "./constants/routes";

/**
 * Whether the builder is on: as configured, else in development only (see
 * `isBuilderEnabled`).
 */
export function builderEnabled(
  config: DmsBuilderConfig | undefined,
  dev: boolean,
): boolean {
  return config?.api?.enabled ?? dev;
}

/**
 * The builder's part of the module's frontend registration: whether it is on,
 * under the key the frontend's builder setup reads it from. A frontend can be
 * built once and served later, so the setup registers the editor only when the
 * registration it is served with says `true`.
 */
export function builderFrontendOptions(
  config: DmsBuilderConfig | undefined,
  dev: boolean,
): Pick<AddFrontendModuleOptions, "configKey" | "options"> {
  return {
    configKey: FRONTEND_MODULE_CONFIG_KEY,
    options: { [FRONTEND_MODULE_ENABLED_OPTION]: builderEnabled(config, dev) },
  };
}
