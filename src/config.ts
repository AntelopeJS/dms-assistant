import { z } from "zod";
import type { DmsBuilderConfig } from "./builder/config";

/** Module configuration, as declared under the module's `config` in `antelope.config.ts`. */
export interface AIConfig {
  /** Origin the sidecar reaches the DMS backend on, flags and all. */
  backendUrl?: string;
  /** The builder's own settings: the source root it rewrites and whether its API and editor are on. */
  builder?: DmsBuilderConfig;
}

const OriginSchema = z.string().trim().min(1);

/** The builder keys this module understands; a value of the wrong type leaves that key on its default. */
const BuilderConfigSchema = z.object({
  projectRoot: z.string().optional().catch(undefined),
  api: z
    .object({ enabled: z.boolean().optional().catch(undefined) })
    .optional()
    .catch(undefined),
});

/**
 * Keeps only the keys this module understands: `backendUrl` when it carries a
 * non-empty origin, and `builder` when it is an object. Anything else leaves
 * the module on its defaults.
 */
export const ConfigSchema = z
  .object({
    backendUrl: z.unknown().optional(),
    builder: z.unknown().optional(),
  })
  .transform(({ backendUrl, builder }): AIConfig => {
    const config: AIConfig = {};
    const origin = OriginSchema.safeParse(backendUrl);
    if (origin.success) config.backendUrl = origin.data;
    const builderConfig = BuilderConfigSchema.safeParse(builder);
    if (builderConfig.success) config.builder = builderConfig.data;
    return config;
  });

let current: AIConfig = {};

export function setConfig(config: AIConfig): void {
  current = config;
}

export function getConfig(): AIConfig {
  return current;
}
