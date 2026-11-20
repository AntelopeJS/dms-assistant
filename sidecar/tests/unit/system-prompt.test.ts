import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agent/system-prompt.js";
import { SAFE_MODE_SKILL_NAME } from "../../src/constants/codex.js";

const BEST_PRACTICES_SKILL = "dms-best-practices";
const CODE_MODE_SKILL = "dms-assistant-code-mode";

describe("system prompt", () => {
  const prompt = buildSystemPrompt({ hostProjectRoot: "/srv/app" });

  it("sends the agent to the page skills before it edits a page", () => {
    const loopStep = prompt
      .split("\n")
      .find((line) => line.includes(BEST_PRACTICES_SKILL));
    expect(loopStep).toMatch(/^1\. /);
    expect(loopStep).toContain(CODE_MODE_SKILL);
    expect(loopStep).toContain(SAFE_MODE_SKILL_NAME);
  });

  it("names each skill once per decision point", () => {
    expect(prompt.split(BEST_PRACTICES_SKILL)).toHaveLength(2);
    expect(prompt.split(CODE_MODE_SKILL)).toHaveLength(2);
  });

  it("stays within 5,000 characters, the cost every request of every turn pays (fails when instructions the skills already carry come back)", () => {
    expect(prompt.length).toBeLessThanOrEqual(5_000);
  });

  it("sends the agent to list_pages for a page's route before it navigates, and to refresh it for a new page (fails when a trim drops the route rule)", () => {
    const loopStep = prompt.split("\n").find((line) => line.startsWith("2. "));
    expect(loopStep).toContain("mcp__dms__list_pages");
    expect(loopStep).toContain("refresh:true");
    expect(loopStep).toMatch(/never derive, guess or construct a URL/);
  });

  it("forbids a Safe mode substitute for what no builder tool can build, and asks to switch instead (fails when a percentage KPI may be built as a count)", () => {
    const safeMode = prompt
      .split("\n")
      .find((line) => line.startsWith("- SAFE: "));
    expect(safeMode).toMatch(/never build something else in its place/);
    expect(safeMode).toMatch(/ask permission to switch to Code mode/);
  });
});
