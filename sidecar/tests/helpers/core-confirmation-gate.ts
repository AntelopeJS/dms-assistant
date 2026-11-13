import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * The gate of the `@antelopejs/dms` this repository pins, by path: the
 * package's exports keep its `dist` private.
 */
const CORE_GATE_PATH = fileURLToPath(
  new URL(
    "../../../node_modules/@antelopejs/dms/dist/mcp/confirmation-gate.js",
    import.meta.url,
  ),
);

const ToolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  isError: z.boolean().optional(),
});

const GateSchema = z.object({
  hold: z.function({
    input: [z.string(), z.json()],
    output: ToolResultSchema.optional(),
  }),
});

const CoreGateModuleSchema = z.object({
  REPEAT_CONFIRMATION_WINDOW_MS: z.number(),
  createRepeatConfirmationGate: z.function({
    input: [z.function({ input: [], output: z.number() })],
    output: GateSchema,
  }),
});

export const coreConfirmationGate = CoreGateModuleSchema.parse(
  createRequire(import.meta.url)(CORE_GATE_PATH),
);
