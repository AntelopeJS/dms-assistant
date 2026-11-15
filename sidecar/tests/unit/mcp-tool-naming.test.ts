import { describe, expect, it } from "vitest";
import { buildToolDefinitions } from "../../src/mcp/tool-definitions.js";
import { BINDINGS, buildDeps, listTools } from "../helpers/mcp-tools.js";

const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

describe.each(BINDINGS)("tools served by %s", (_binding, build) => {
  it("lists every declared tool", async () => {
    const declared = buildToolDefinitions(buildDeps()).map((t) => t.name);
    const listed = await listTools(build());
    expect(listed.map((tool) => tool.name).sort()).toEqual(declared.sort());
  });

  it("names every tool in snake_case", async () => {
    const offenders = (await listTools(build()))
      .map((tool) => tool.name)
      .filter((name) => !SNAKE_CASE.test(name));
    expect(offenders).toEqual([]);
  });

  it("gives every tool a readable title other than its name", async () => {
    const offenders = (await listTools(build()))
      .map((tool) => ({
        name: tool.name,
        title: tool.title ?? tool.annotations?.title,
      }))
      .filter(
        (tool) =>
          tool.title === undefined ||
          tool.title.trim() === "" ||
          tool.title === tool.name,
      );
    expect(offenders).toEqual([]);
  });
});
