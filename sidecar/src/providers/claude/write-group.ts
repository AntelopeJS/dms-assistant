import { randomUUID } from "node:crypto";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  MOCKUP_WRITE_GROUP_FIELD,
  MOCKUP_WRITE_TOOL_NAMES,
} from "../../constants/builder.js";
import { PRE_TOOL_USE_HOOK_EVENT } from "../../constants/claude.js";
import { DMS_MCP_TOOL_NAME_PREFIX } from "../../constants/mcp.js";
import type { SdkHooks } from "./safe-mode.js";

const MOCKUP_WRITE_TOOLS: ReadonlySet<string> = new Set(
  MOCKUP_WRITE_TOOL_NAMES.map((name) => `${DMS_MCP_TOOL_NAME_PREFIX}${name}`),
);

const writeCallSchema = z.object({
  tool_name: z.string().catch(""),
  tool_input: z.record(z.string(), z.unknown()).catch({}),
});

/**
 * The id of the assistant reply in flight, which the DMS reads as the write
 * group of the mockup versions that reply writes. One session serves every
 * turn of a conversation, so the id belongs to the turn, not to the session.
 */
export interface WriteGroups {
  /** Starts the next reply and returns its id: 1 to 128 characters of `[A-Za-z0-9_-]`. */
  begin(): string;
  current(): string;
}

export function createWriteGroups(): WriteGroups {
  let current = randomUUID();
  return {
    begin: () => {
      current = randomUUID();
      return current;
    },
    current: () => current,
  };
}

/**
 * Adds a `PreToolUse` hook that sets the `writeGroup` of every mockup write to
 * the current reply's id, overwriting any value the model put there. The CLI
 * runs hooks whatever the permission mode, which `canUseTool` does not.
 */
export function withWriteGroup(hooks: SdkHooks, groups: WriteGroups): SdkHooks {
  const stamp: HookCallback = (input) => {
    const parsed = writeCallSchema.safeParse(input);
    if (!parsed.success || !MOCKUP_WRITE_TOOLS.has(parsed.data.tool_name)) {
      return Promise.resolve({ continue: true });
    }
    return Promise.resolve({
      hookSpecificOutput: {
        hookEventName: PRE_TOOL_USE_HOOK_EVENT,
        updatedInput: {
          ...parsed.data.tool_input,
          [MOCKUP_WRITE_GROUP_FIELD]: groups.current(),
        },
      },
    });
  };
  return {
    ...hooks,
    [PRE_TOOL_USE_HOOK_EVENT]: [
      ...(hooks[PRE_TOOL_USE_HOOK_EVENT] ?? []),
      { hooks: [stamp] },
    ],
  };
}
