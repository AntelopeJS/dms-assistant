import { rm } from "node:fs/promises";
import { matchesGlob } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SECRET_FILE_SEARCH_EXCLUSIONS } from "../../src/agent/project-secrets.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { SECRET_FILE_TEMPLATE_NAMES } from "../../src/constants/project-secrets.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { buildTurnOverrides } from "../../src/providers/codex/config.js";
import { CODEX_READ_ONLY_PROFILE } from "../../src/providers/codex/permission-profiles.js";
import {
  broken,
  claudeEditCases,
  claudeReadAndEditCases,
  type Case,
  codexPatchCases,
  commandCases,
  configTargets,
  secretTargets,
  STANDINGS,
  UNSTOPPED,
} from "./agent-file-access-cases.js";
import { claudeVerdict, rewrittenGlob } from "./agent-file-access-pipeline.js";
import {
  CLAUDE_MODES,
  CODEX_MODES,
  CONFIG_WRITING_COMMANDS,
  createProject,
  GENERATIONS,
  GLOBS,
  inProject,
  type Project,
  SECRET_READING_COMMANDS,
  SKILL_SOURCES,
  type Verdict,
  WHOLE_DIRECTORY_SEARCHES,
} from "./agent-file-access-scopes.js";

let project: Project;

beforeAll(async () => {
  setBuilderAvailable(true);
  project = await createProject();
});

afterAll(async () => {
  setBuilderAvailable(false);
  await rm(project.root, { recursive: true, force: true });
});

const TEST_TIMEOUT_MS = 120_000;

const isNotRefused = (verdict: Verdict): boolean => verdict !== "refused";
const isUnstopped = (verdict: Verdict): boolean => UNSTOPPED.includes(verdict);

const SECRET_FILE_NAMES = [
  ".env",
  ".ENV",
  ".Env",
  ".env.local",
  ".env.production",
  ".env.LOCAL",
  ".env.staging.eu",
  ".env.x",
];

const TEMPLATE_NAMES = [...SECRET_FILE_TEMPLATE_NAMES];

function globCases(): Case[] {
  return CLAUDE_MODES.flatMap((mode) =>
    GENERATIONS.flatMap((generation) =>
      GLOBS.flatMap(({ glob }) =>
        (
          [
            ["Grep", "glob"],
            ["Glob", "pattern"],
          ] as const
        ).map(([tool, key]) => ({
          label: `claude ${mode}/${generation} ${tool}(${key}=${glob})`,
          run: () =>
            claudeVerdict({
              project,
              mode,
              generation,
              tool,
              args: { [key]: glob },
            }),
        })),
      ),
    ),
  );
}

async function searchesThatReachSecrets(): Promise<string[]> {
  const reaching = new Set(
    GLOBS.filter((g) => g.reachesSecret).map((g) => g.glob),
  );
  const found = await broken(
    globCases().filter(({ label }) =>
      [...reaching].some((glob) => label.endsWith(`=${glob})`)),
    ),
    isNotRefused,
  );
  const searches = CLAUDE_MODES.flatMap((mode) =>
    GENERATIONS.flatMap((generation) =>
      WHOLE_DIRECTORY_SEARCHES.map((search) => ({ mode, generation, search })),
    ),
  );
  for (const { mode, generation, search } of searches) {
    const args = Object.fromEntries(
      Object.entries(search).map(([key, value]) => [
        key,
        inProject(project, value),
      ]),
    );
    const call = { project, mode, generation, tool: "Grep", args };
    if ((await claudeVerdict(call)) === "refused") continue;
    const glob = await rewrittenGlob(call);
    const excluded = SECRET_FILE_SEARCH_EXCLUSIONS.every((exclusion) =>
      glob?.split(" ").includes(exclusion),
    );
    if (!excluded) {
      found.push(
        `claude ${mode}/${generation} Grep ${JSON.stringify(search)} searches .env files, glob ${glob}`,
      );
    }
  }
  return found;
}

describe("a call that could read a secret file is refused, in every provider, mode and tool", () => {
  it(
    "refuses every Claude file tool on every way of naming a .env file (fails a guard that skips a tool, a link, a letter case or a padded path)",
    async () => {
      const cases = claudeReadAndEditCases(project, secretTargets());
      expect(await broken(cases, isNotRefused)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a Grep or Glob whose file-name glob reaches a .env file, and rewrites every other Grep to leave .env files out (fails a Grep with no path or glob, or a glob such as .env*)",
    async () => {
      expect(await searchesThatReachSecrets()).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "never lets a command that reads a .env file run unasked, in Claude or Codex, in any mode (fails Plan only running read-only commands unasked)",
    async () => {
      const cases = commandCases(project, SECRET_READING_COMMANDS);
      expect(await broken(cases, isUnstopped)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "declines every Codex patch that writes, moves or deletes a .env file without asking, a rename's two ends included (fails a handler that asks about a secret file, or reads only a rename's source)",
    async () => {
      const targets = secretTargets().filter(
        ({ claudeOnly }) => claudeOnly !== true,
      );
      const cases = codexPatchCases(project, targets, [
        "everything under the project",
      ]);
      expect(await broken(cases, isNotRefused)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it("keeps every .env file unreadable in Codex's one profile, and every committed template readable (fails a profile whose globs miss a letter case or a .env.<name>)", async () => {
    const { buildPermissionProfile } =
      await import("../../src/providers/codex/permission-profiles.js");
    const profile = buildPermissionProfile({
      hostProjectRoot: project.root,
      moduleRoots: [],
    });
    const reached = (name: string): boolean =>
      profile.unreadableGlobs.some((glob) =>
        matchesGlob(name, glob.replace("**/", "")),
      );
    expect(SECRET_FILE_NAMES.filter((name) => !reached(name))).toEqual([]);
    expect(TEMPLATE_NAMES.filter(reached)).toEqual([]);
    const overrides = CODEX_MODES.flatMap((mode) =>
      GENERATIONS.map((generation) =>
        buildTurnOverrides({
          ...DEFAULT_SETTINGS,
          mode,
          generationMode: generation,
        }),
      ),
    );
    for (const turn of overrides) {
      expect(turn).toMatchObject({
        permissions: CODEX_READ_ONLY_PROFILE,
        approvalPolicy: "on-request",
      });
    }
  });

  it("keeps a skill's inline shell commands, hooks and @ references from reading a .env file in every Claude session (fails settings that leave any of the three on)", async () => {
    const { SDK_SESSION_SETTINGS } =
      await import("../../src/providers/claude/session-settings.js");
    const deniedByRule = (name: string): boolean =>
      SDK_SESSION_SETTINGS.permissions.deny.some((rule) => {
        const glob = /^Read\(\/\/(.*)\)$/.exec(rule)?.[1];
        return (
          glob !== undefined && matchesGlob(`/srv/app/${name}`, `/${glob}`)
        );
      });
    const settled = {
      "inline shell command": SDK_SESSION_SETTINGS.disableSkillShellExecution,
      "hooks frontmatter": SDK_SESSION_SETTINGS.disableAllHooks,
      "@ reference":
        SECRET_FILE_NAMES.every(deniedByRule) &&
        !TEMPLATE_NAMES.some(deniedByRule),
    } satisfies Record<(typeof SKILL_SOURCES)[number], boolean>;
    expect(SKILL_SOURCES.filter((source) => !settled[source])).toEqual([]);
  });
});

describe("a write to a file core reads its configuration from asks the owner, in every provider and mode", () => {
  it(
    "never lets a Claude edit of antelope.config.ts, an antelope.*.json or .antelope/ run unasked, standing rules or not (fails the always-ask set before #66)",
    async () => {
      const cases = claudeEditCases(project, configTargets());
      expect(await broken(cases, isUnstopped)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "never lets a Codex patch onto a configuration file run unasked, a rename's two ends included (fails the always-ask set before #66)",
    async () => {
      const cases = codexPatchCases(project, configTargets(), STANDINGS);
      expect(await broken(cases, isUnstopped)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "never lets a command that writes a configuration file run unasked (fails a mode that runs read-only commands unasked)",
    async () => {
      const cases = commandCases(project, CONFIG_WRITING_COMMANDS);
      expect(await broken(cases, isUnstopped)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
