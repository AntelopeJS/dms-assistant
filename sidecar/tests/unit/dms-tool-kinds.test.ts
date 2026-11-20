import { describe, expect, it } from "vitest";
import {
  isLiveReadTool,
  isMutatingBuilderTool,
  isMutatingTool,
  permissionKindOf,
} from "../../src/agent/tool-kinds.js";
import {
  DMS_MCP_TOOL_NAME_PREFIX,
  MCP_TOOL_NAME_PREFIX,
} from "../../src/constants/mcp.js";

const dms = (name: string): string => `${DMS_MCP_TOOL_NAME_PREFIX}${name}`;

describe("the kind of a DMS MCP tool", () => {
  it.each([
    "builder_configure_column_groups",
    "builder_set_connection_access",
    "mockup_apply_to_page",
  ])("counts %s, a listed tool, as a change", (name) => {
    expect(isMutatingBuilderTool(dms(name))).toBe(true);
    expect(permissionKindOf(dms(name))).toBe("builder");
  });

  it.each(["mockup_read_spec", "database_project"])(
    "counts %s as a read",
    (name) => {
      expect(isMutatingBuilderTool(dms(name))).toBe(false);
    },
  );

  it("counts a DMS tool the lists do not name as a change, so it is tracked and checkpointed (fails a classifier that leaves it a read)", () => {
    const name = dms("drop_everything");
    expect(isMutatingBuilderTool(name)).toBe(true);
    expect(isMutatingTool(name)).toBe(true);
    expect(permissionKindOf(name)).toBe("builder");
  });

  it("leaves a tool of another server unclassified", () => {
    expect(isMutatingBuilderTool("mcp__other__drop_everything")).toBe(false);
    expect(permissionKindOf("mcp__other__drop_everything")).toBe("other");
  });
});

describe("the tools that read the running app", () => {
  it.each([
    dms("page_verify"),
    dms("builder_map_resources"),
    `${MCP_TOOL_NAME_PREFIX}navigate_to_page`,
    dms("navigate_to_page"),
    "page_verify",
  ])(
    "counts %s as a live read (fails a list that names one prefix only)",
    (name) => {
      expect(isLiveReadTool(name)).toBe(true);
    },
  );

  it.each([
    dms("builder_add_block"),
    dms("builder_list_resources"),
    `${MCP_TOOL_NAME_PREFIX}get_current_page`,
    "mcp__other__page_verify",
    "Bash",
  ])("leaves %s out, so its call never releases a hold", (name) => {
    expect(isLiveReadTool(name)).toBe(false);
  });
});
