import {
  type CodexChange,
  claudeVerdict,
  codexVerdict,
  type Standing,
} from "./agent-file-access-pipeline.js";
import {
  CLAUDE_MODES,
  CODEX_MODES,
  EDIT_TOOLS,
  FILE_TOOLS,
  GENERATIONS,
  inProject,
  type Project,
  TARGETS,
  type Target,
  type Verdict,
} from "./agent-file-access-scopes.js";

/** One call to put to a provider's real permission code, and a label that names its tuple. */
export interface Case {
  label: string;
  run: () => Promise<Verdict>;
}

export const STANDINGS: readonly Standing[] = [
  "none",
  "everything under the project",
];

export const UNSTOPPED: readonly Verdict[] = ["silent", "filtered"];

/** The labels of the cases whose verdict `isBroken` rejects, each with the verdict. */
export async function broken(
  cases: readonly Case[],
  isBroken: (verdict: Verdict) => boolean,
): Promise<string[]> {
  const found: string[] = [];
  for (const { label, run } of cases) {
    const verdict = await run();
    if (isBroken(verdict)) found.push(`${label}: ${verdict}`);
  }
  return found;
}

export function secretTargets(): Target[] {
  return TARGETS.filter((target) => target.kind === "secret");
}

export function configTargets(): Target[] {
  return TARGETS.filter((target) => target.kind === "config");
}

/** Every Claude file tool, on each target, in each mode, scope and standing. */
function claudeFileToolCases(
  project: Project,
  targets: readonly Target[],
  tools: ReadonlyArray<{ tool: string; key: string }>,
  standings: readonly Standing[],
): Case[] {
  return standings.flatMap((standing) =>
    CLAUDE_MODES.flatMap((mode) =>
      GENERATIONS.flatMap((generation) =>
        tools.flatMap(({ tool, key }) =>
          targets.map((target) => ({
            label: `claude ${mode}/${generation} ${tool}(${key}) on ${target.name}, standing ${standing}`,
            run: () =>
              claudeVerdict({
                project,
                mode,
                generation,
                tool,
                args: { [key]: inProject(project, target.path) },
                standing,
              }),
          })),
        ),
      ),
    ),
  );
}

export function claudeEditCases(
  project: Project,
  targets: readonly Target[],
): Case[] {
  return claudeFileToolCases(project, targets, EDIT_TOOLS, STANDINGS);
}

export function claudeReadAndEditCases(
  project: Project,
  targets: readonly Target[],
): Case[] {
  return claudeFileToolCases(project, targets, FILE_TOOLS, [
    "everything under the project",
  ]);
}

interface Patch {
  label: string;
  changes: CodexChange[];
}

/** The shapes of one Codex patch that reaches `target`. */
function patchesReaching(project: Project, target: Target): Patch[] {
  const there = inProject(project, target.path);
  const elsewhere = inProject(project, "src/page.ts");
  const kinds = (["add", "update", "delete"] as const).map((kind) => ({
    label: kind,
    changes: [{ path: there, kind }],
  }));
  return [
    ...kinds,
    {
      label: "rename onto it",
      changes: [{ path: elsewhere, kind: "update", movePath: there }],
    },
    {
      label: "rename from it",
      changes: [{ path: there, kind: "update", movePath: elsewhere }],
    },
    {
      label: "patch of two files, one of them it",
      changes: [
        { path: elsewhere, kind: "update" },
        { path: there, kind: "update" },
      ],
    },
  ];
}

export function codexPatchCases(
  project: Project,
  targets: readonly Target[],
  standings: readonly Standing[],
): Case[] {
  return standings.flatMap((standing) =>
    CODEX_MODES.flatMap((mode) =>
      GENERATIONS.flatMap((generation) =>
        targets.flatMap((target) =>
          patchesReaching(project, target).map((patch) => ({
            label: `codex ${mode}/${generation} ${patch.label} ${target.name}, standing ${standing}`,
            run: () =>
              codexVerdict({
                project,
                mode,
                generation,
                request: { changes: patch.changes },
                standing,
              }),
          })),
        ),
      ),
    ),
  );
}

/** Every command in each provider, mode and scope, with and without standing rules. */
export function commandCases(
  project: Project,
  commands: readonly string[],
): Case[] {
  return STANDINGS.flatMap((standing) =>
    GENERATIONS.flatMap((generation) =>
      commands.flatMap((command) => [
        ...CLAUDE_MODES.map((mode) => ({
          label: `claude ${mode}/${generation} Bash "${command}", standing ${standing}`,
          run: () =>
            claudeVerdict({
              project,
              mode,
              generation,
              tool: "Bash",
              args: { command },
              standing,
            }),
        })),
        ...CODEX_MODES.map((mode) => ({
          label: `codex ${mode}/${generation} "${command}", standing ${standing}`,
          run: () =>
            codexVerdict({
              project,
              mode,
              generation,
              request: { command },
              standing,
            }),
        })),
      ]),
    ),
  );
}
