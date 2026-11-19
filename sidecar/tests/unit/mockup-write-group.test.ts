import { describe, expect, it } from "vitest";
import { DMS_MCP_TOOL_NAME_PREFIX } from "../../src/constants/mcp.js";
import { useClaudeTurnRunner } from "../helpers/claude-turn-runner.js";

const TEST_TIMEOUT_MS = 30_000;
const DMS = DMS_MCP_TOOL_NAME_PREFIX;
const WRITE_GROUP_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MODEL_CHOSEN = "chosen-by-the-model";

describe("the write group of a mockup write", () => {
  const { runTurn } = useClaudeTurnRunner();

  async function writesOf(turns: number) {
    const run = await runTurn(
      [
        {
          id: "write",
          name: `${DMS}mockup_write_spec`,
          input: { name: "bikes", writeGroup: MODEL_CHOSEN },
        },
        {
          id: "patch",
          name: `${DMS}mockup_patch_spec`,
          input: { name: "bikes", ops: [] },
        },
        {
          id: "read",
          name: `${DMS}mockup_annotations`,
          input: { name: "bikes" },
        },
      ],
      { turns },
    );
    return run.toolInputs;
  }

  it(
    "is the same on two writes of one turn, and a value the model chose is replaced",
    async () => {
      const [write, patch, read] = await writesOf(1);
      expect(write?.input?.writeGroup).toMatch(WRITE_GROUP_PATTERN);
      expect(write?.input?.writeGroup).not.toBe(MODEL_CHOSEN);
      expect(patch?.input?.writeGroup).toBe(write?.input?.writeGroup);
      expect(read?.input).not.toHaveProperty("writeGroup");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "is another one on the next turn of the same session",
    async () => {
      const writes = (await writesOf(2)).filter(
        (call) => call.input?.writeGroup !== undefined,
      );
      const groups = writes.map((call) => call.input?.writeGroup);
      expect(groups).toHaveLength(4);
      expect(groups[0]).toBe(groups[1]);
      expect(groups[2]).toBe(groups[3]);
      expect(groups[2]).not.toBe(groups[0]);
    },
    TEST_TIMEOUT_MS,
  );
});
