import path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import { ListModuleDeclarations } from "@antelopejs/interface-core/modules";
import {
  type BuilderError,
  ConfigureProject,
  GetDatabaseProject,
  ListEntryConnections,
} from "@antelopejs/interface-dms-builder";
import { z } from "zod";
import { withinDmsTimeout } from "../builder/dms-answer";
import { SIDECAR_LOG_PREFIX } from "../constants/sidecar";
import {
  DMS_PATHS,
  type DeclaredConnection,
  type DmsKey,
  type DmsSettings,
  type LegacyEntry,
  planMove,
} from "./builder-settings-plan";
import {
  byHandText,
  conflictText,
  moveText,
  type NotMoved,
  notMovedText,
  unreadEnvironmentsText,
  verdictText,
} from "./builder-settings-text";
import { type Carried, isSafe, verdictOf } from "./entry-verdict";
import { environmentBindings } from "./environment-bindings";
import { type Declarations, legacyEntries, relativeTo } from "./legacy-entries";

const DMS_KEYS: readonly DmsKey[] = ["projectRoot", "enabled", "backendUrl"];

const SectionSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .catch(undefined);

/** The settings the dms entry declares, whatever they evaluate to, a projectRoot relative to `cwd`. */
function dmsSettingsSchema(cwd: string) {
  const comparable: Record<DmsKey, z.ZodType> = {
    projectRoot: z.union([
      z
        .string()
        .min(1)
        .transform((folder) => relativeTo(cwd, folder)),
      z.unknown(),
    ]),
    enabled: z.unknown(),
    backendUrl: z.unknown(),
  };
  return z
    .object({ builder: SectionSchema, mcp: SectionSchema })
    .catch({ builder: undefined, mcp: undefined })
    .transform(
      (sections): DmsSettings =>
        new Map(
          DMS_KEYS.flatMap((key): [DmsKey, unknown][] => {
            const [section, name] = DMS_PATHS[key];
            const declared = sections[section];
            return declared !== undefined && Object.hasOwn(declared, name)
              ? [[key, comparable[key].parse(declared[name])]]
              : [];
          }),
        ),
    );
}

const HOLD_NOTHING_BACK: ReadonlySet<BuilderError["code"]> = new Set([
  "not_found",
  "unsupported",
]);

interface Unreadable {
  id: string;
  error: BuilderError;
  /** Whether the refusal holds back every connection move. */
  holds: boolean;
}

interface ReadConnections {
  connections: Map<string, DeclaredConnection[]>;
  unreadable: Unreadable[];
}

/**
 * The connections of each entry, read one entry after the other, since each read sets and restores
 * the project's variables in `process.env`. Every refusal of a `removable` entry is unreadable.
 */
async function readConnections(
  ids: readonly string[],
  removable: ReadonlySet<string>,
): Promise<ReadConnections> {
  const read: ReadConnections = { connections: new Map(), unreadable: [] };
  for (const id of ids) {
    const answer = await withinDmsTimeout(ListEntryConnections(id));
    if (answer.ok) {
      read.connections.set(
        id,
        answer.data.flatMap(({ interface: interfaceId, source, id: name }) =>
          name === undefined
            ? []
            : [{ interface: interfaceId, source, id: name }],
        ),
      );
    } else {
      const holds = !HOLD_NOTHING_BACK.has(answer.error.code);
      if (holds || removable.has(id)) {
        read.unreadable.push({ id, error: answer.error, holds });
      }
    }
  }
  return read;
}

function warn(text: string): void {
  Logging.Warn(`${SIDECAR_LOG_PREFIX} ${text}`);
}

/** Every setting and connection of the legacy entries, to move by hand when no move runs. */
function everything(
  legacyByPrecedence: readonly LegacyEntry[],
  legacy: ReadConnections,
): string[] {
  const unreadable = new Set(legacy.unreadable.map(({ id }) => id));
  return legacyByPrecedence.flatMap(({ id, settings }) => [
    ...settings.map((setting) =>
      moveText({ kind: "setting", from: id, setting }),
    ),
    ...(unreadable.has(id) || (legacy.connections.get(id)?.length ?? 0) > 0
      ? [`the connections of "${id}"`]
      : []),
  ]);
}

interface Gathered {
  cwd: string;
  projectPath: string;
  declarations: Declarations;
  legacyByPrecedence: LegacyEntry[];
  legacy: ReadConnections;
}

async function carry(
  { cwd, projectPath, declarations, legacyByPrecedence, legacy }: Gathered,
  dmsId: string,
  notMoved: NotMoved,
): Promise<Carried> {
  const legacyIds = new Set(legacyByPrecedence.map(({ id }) => id));
  const others = await readConnections(
    [...declarations.keys()].filter((id) => !legacyIds.has(id)),
    new Set(),
  );
  const unreadable = [...legacy.unreadable, ...others.unreadable];
  const dmsSettings = dmsSettingsSchema(cwd).parse(
    declarations.get(dmsId)?.config,
  );
  const plan = planMove({
    dmsId,
    dmsSettings,
    unmovable: new Set(
      path.resolve(projectPath) === cwd ? [] : ["projectRoot"],
    ),
    legacyByPrecedence,
    connections: new Map([...legacy.connections, ...others.connections]),
    holdConnections: unreadable.some(({ holds }) => holds),
  });
  notMoved.refusals.push(...unreadable.map(({ error }) => error));
  notMoved.byHand.push(
    ...legacy.unreadable.map(({ id }) => `the connections of "${id}"`),
    ...plan.heldConnectionMoves.map(moveText),
  );
  for (const conflict of plan.conflicts) warn(conflictText(dmsId, conflict));
  if (plan.byHand.length > 0) {
    warn(byHandText(dmsId, { cwd, projectPath }, plan.byHand));
  }
  const nothingWritten = { ...nothingCarried(legacy), dms: dmsSettings };
  if (plan.steps.length === 0) return nothingWritten;
  const result = await ConfigureProject(plan.steps);
  if (!result.ok) {
    notMoved.refusals.push(result.error);
    notMoved.byHand.push(...plan.moves.map(moveText));
    return nothingWritten;
  }
  Logging.Info(
    `${SIDECAR_LOG_PREFIX} Moved to the "${dmsId}" entry of antelope.config.ts, where @antelopejs/dms reads them: ${plan.moves.map(moveText).join("; ")}. Start the project again for @antelopejs/dms to serve them.`,
  );
  return {
    wrote: true,
    connections: legacy.connections,
    leaving: plan.leaving,
    dms: plan.dmsAfter,
  };
}

function nothingCarried(legacy: ReadConnections): Carried {
  return {
    wrote: false,
    connections: legacy.connections,
    leaving: new Map(),
    dms: new Map(),
  };
}

/** Carries what the legacy entries hold, and says once what it could not. */
async function carryAll(gathered: Gathered): Promise<Carried> {
  const { legacyByPrecedence, legacy, projectPath } = gathered;
  const holds =
    legacy.unreadable.length > 0 ||
    legacyByPrecedence.some(
      ({ id, settings }) =>
        settings.length > 0 || (legacy.connections.get(id)?.length ?? 0) > 0,
    );
  if (!holds) return nothingCarried(legacy);
  const notMoved: NotMoved = { refusals: [], byHand: [] };
  const project = await withinDmsTimeout(GetDatabaseProject());
  const carried = project.ok
    ? await carry(gathered, project.data.self, notMoved)
    : nothingCarried(legacy);
  if (!project.ok) {
    notMoved.refusals.push(
      ...legacy.unreadable.map(({ error }) => error),
      project.error,
    );
    notMoved.byHand.push(...everything(legacyByPrecedence, legacy));
  }
  if (notMoved.byHand.length > 0) {
    const dmsId = project.ok ? project.data.self : undefined;
    warn(notMovedText({ dmsId, projectPath }, notMoved));
  }
  return carried;
}

async function move(projectPath: string): Promise<void> {
  const cwd = process.cwd();
  const declarations: Declarations = new Map(
    Object.entries(await ListModuleDeclarations()),
  );
  const legacyByPrecedence = await legacyEntries(
    { cwd, projectPath },
    declarations,
  );
  const removable = legacyByPrecedence.filter((entry) => entry.removable);
  const removableIds = removable.map(({ id }) => id);
  const bindings = await environmentBindings(projectPath, removableIds);
  if (!bindings.readable) {
    warn(unreadEnvironmentsText(bindings.reason, removableIds));
  }
  const legacy = await readConnections(
    legacyByPrecedence.map(({ id }) => id),
    new Set(removableIds),
  );
  const carried = await carryAll({
    cwd,
    projectPath,
    declarations,
    legacyByPrecedence,
    legacy,
  });
  for (const entry of removable) {
    const verdict = verdictOf(entry, carried, bindings);
    const text = `${SIDECAR_LOG_PREFIX} ${verdictText(verdict, carried.wrote)}`;
    if (isSafe(verdict)) Logging.Info(text);
    else Logging.Warn(text);
  }
}

export async function moveLegacyBuilderSettings(
  projectPath: string,
): Promise<void> {
  try {
    await move(projectPath);
  } catch (error) {
    Logging.Warn(
      `${SIDECAR_LOG_PREFIX} The builder settings and connections of dms-assistant, dms-builder and dms-ai were not moved:`,
      error,
    );
  }
}
