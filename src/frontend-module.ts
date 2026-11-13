import path from "node:path";
import type { AddFrontendModuleOptions } from "@antelopejs/interface-dms/page";
import { builderFrontendOptions } from "./builder/frontend-module";
import type { AIConfig } from "./config";
import {
  FRONTEND_BACKEND_PROXY,
  FRONTEND_MODULE_DIR,
  FRONTEND_MODULE_NAME,
  FRONTEND_MODULE_PRIORITY,
} from "./constants/frontend-module";

/** What the registration knows besides the config. */
interface FrontendModuleContext {
  /** Whether the project runs in development, as the core reports it. */
  dev: boolean;
}

/**
 * This module's frontend, from its configuration alone: the backend registers
 * it with `AddFrontendModule`, and `@antelopejs/dms-frontend` calls this same
 * function (declared as `dmsFrontend` in package.json) to build and start the
 * frontend without a backend. It reads nothing but its arguments. The one
 * registration serves the assistant and the builder; its options say whether
 * the builder is on.
 */
export function frontendModule(
  config: AIConfig | undefined,
  { dev }: FrontendModuleContext,
): AddFrontendModuleOptions {
  return {
    name: FRONTEND_MODULE_NAME,
    sourcePath: path.join(__dirname, FRONTEND_MODULE_DIR),
    renderer: { name: "vue", version: "3" },
    priority: FRONTEND_MODULE_PRIORITY,
    backendProxies: [FRONTEND_BACKEND_PROXY],
    ...builderFrontendOptions(config?.builder, dev),
  };
}
