import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { hiddenToolsFor } from "../../src/providers/claude/tool-surface.js";
import type { TurnSettings } from "../../src/state/settings-types.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";

function settingsOf(patch: Partial<TurnSettings>): TurnSettings {
  return { ...TURN_SETTINGS, ...patch };
}

describe("the built-in tools Safe mode hides from the model", () => {
  beforeAll(() => setBuilderAvailable(true));
  afterAll(() => setBuilderAvailable(false));

  it("hides commands, notebook edits and file edits in Safe mode (fails a Safe session that still shows Bash, Write, Edit or NotebookEdit)", () => {
    expect(
      [...hiddenToolsFor(settingsOf({ generationMode: "safe" }))].sort(),
    ).toEqual(["Bash", "Edit", "NotebookEdit", "Write"]);
  });

  it("keeps Write and Edit for the plan file in Safe mode's Plan only (fails a Safe plan chat that cannot write its plan)", () => {
    const hidden = hiddenToolsFor(
      settingsOf({ generationMode: "safe", mode: "plan" }),
    );

    expect([...hidden].sort()).toEqual(["Bash", "NotebookEdit"]);
  });

  it("hides nothing in Code mode (fails a Code session that loses a tool)", () => {
    expect(hiddenToolsFor(settingsOf({ generationMode: "vibe" }))).toEqual([]);
    expect(
      hiddenToolsFor(settingsOf({ generationMode: "vibe", mode: "plan" })),
    ).toEqual([]);
  });
});

describe("Safe mode without the Builder", () => {
  it("hides nothing, as the session runs in Code mode (fails a session that hides tools the guard would let through)", () => {
    setBuilderAvailable(false);

    expect(hiddenToolsFor(settingsOf({ generationMode: "safe" }))).toEqual([]);
  });
});
