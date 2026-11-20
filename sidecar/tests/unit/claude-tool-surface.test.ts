import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";
import { createInputQueue } from "../../src/providers/claude/input-queue.js";
import { createModelTrack } from "../../src/providers/claude/model-fallback.js";
import { resolveModelOptions } from "../../src/providers/claude/config.js";
import {
  hiddenToolsFor,
  syncToolSurface,
  toolSurfaceFor,
  type SurfaceBackend,
} from "../../src/providers/claude/tool-surface.js";
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

describe("the query a Claude session starts again", () => {
  function backendWith(settings: TurnSettings, options: Options) {
    const started: Options[] = [];
    const query = ({ options: given = {} }: { options?: Options }) => {
      started.push(given);
      // SAFETY: syncToolSurface reads only `close` and `setModel` of the query it starts.
      return { close: () => undefined } as Query;
    };
    const backend: SurfaceBackend = {
      sdk: { query },
      options,
      surface: toolSurfaceFor(settings),
      isReleased: true,
      hostProjectRoot: "/project",
      sessionId: "session-1",
      live: { settings },
      queue: createInputQueue(),
      // SAFETY: the released query is only closed, never read.
      output: { close: () => undefined } as Query,
      model: createModelTrack(),
      lastTurn: null,
    };
    return { backend, started };
  }

  it("carries no effort once thinking is off (fails a restart that keeps the effort of the previous thinking level)", () => {
    const { backend, started } = backendWith(settingsOf({ thinking: "off" }), {
      effort: "high",
      thinking: { type: "adaptive" },
    });

    syncToolSurface(backend);

    expect(started[0]?.thinking).toEqual({ type: "disabled" });
    expect(started[0]).not.toHaveProperty("effort");
  });

  it("carries the current effort while thinking is on (fails a restart that keeps the previous effort)", () => {
    const { backend, started } = backendWith(settingsOf({ thinking: "high" }), {
      effort: "low",
      thinking: { type: "adaptive" },
    });

    syncToolSurface(backend);

    expect(started[0]?.effort).toBe(
      resolveModelOptions(backend.live.settings).effort,
    );
    expect(started[0]?.effort).not.toBe("low");
  });
});
