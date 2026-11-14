import type {
  ConfigObject,
  ImportOverrideInput,
  ModuleEntryInput,
  ProjectConfigStep,
} from "@antelopejs/interface-dms-builder";

export type DeclaredConnection = Required<ImportOverrideInput>;

export type DmsKey = "projectRoot" | "enabled" | "backendUrl";

export type DmsValue = string | boolean;

/** Where the `config` of the dms entry holds each setting the move carries. */
export const DMS_PATHS: Readonly<
  Record<DmsKey, readonly [section: "builder" | "mcp", name: string]>
> = {
  projectRoot: ["builder", "projectRoot"],
  enabled: ["builder", "enabled"],
  backendUrl: ["mcp", "backendUrl"],
};

export type DmsSettings = ReadonlyMap<DmsKey, unknown>;

export interface LegacySetting {
  key: DmsKey;
  legacyPath: string;
  value: DmsValue;
}

export interface LegacyEntry {
  id: string;
  /** Whether the upgrade removes the entry: a dms-builder or dms-ai one, not dms-assistant's own. */
  removable: boolean;
  settings: LegacySetting[];
}

export interface ProjectEntries {
  dmsId: string;
  dmsSettings: DmsSettings;
  unmovable: ReadonlySet<DmsKey>;
  legacyByPrecedence: LegacyEntry[];
  connections: ReadonlyMap<string, readonly DeclaredConnection[]>;
  /**
   * Whether an entry holds bindings no one can read. Removing a connection takes it off every
   * entry, that one included, so no connection moves.
   */
  holdConnections: boolean;
}

export interface HeldSetting {
  from: string;
  setting: LegacySetting;
}

export type Move =
  | {
      kind: "connection";
      from: string;
      id: string;
      declared: DeclaredConnection[];
      alreadyOnDms: boolean;
    }
  | ({ kind: "setting" } & HeldSetting);

export type Conflict =
  | {
      kind: "connection";
      from: string;
      id: string;
      legacy: DeclaredConnection[];
      dms: DeclaredConnection[];
    }
  | {
      kind: "setting";
      from: string;
      setting: LegacySetting;
      dms: unknown;
    };

export interface MovePlan {
  steps: ProjectConfigStep[];
  moves: Move[];
  heldConnectionMoves: Move[];
  conflicts: Conflict[];
  byHand: HeldSetting[];
  /** The connection ids that leave each entry once the steps are written. */
  leaving: ReadonlyMap<string, ReadonlySet<string>>;
  /** The settings the dms entry holds once the steps are written. */
  dmsAfter: DmsSettings;
}

function byId(
  declared: readonly DeclaredConnection[],
): Map<string, DeclaredConnection[]> {
  const grouped = new Map<string, DeclaredConnection[]>();
  for (const connection of declared) {
    grouped.set(connection.id, [
      ...(grouped.get(connection.id) ?? []),
      connection,
    ]);
  }
  return grouped;
}

function bindingKey(connection: DeclaredConnection): string {
  return `${connection.interface}\n${connection.id}`;
}

function sameConnection(
  left: readonly DeclaredConnection[],
  right: readonly DeclaredConnection[],
): boolean {
  const bindings = (declared: readonly DeclaredConnection[]) =>
    declared
      .map((connection) => `${bindingKey(connection)}\n${connection.source}`)
      .toSorted()
      .join("\n\n");
  return bindings(left) === bindings(right);
}

interface ConnectionsPlan {
  moves: Move[];
  conflicts: Conflict[];
  leavingIdsByEntry: Map<string, Set<string>>;
  newOnDms: DeclaredConnection[];
}

function planConnections(entries: ProjectEntries): ConnectionsPlan {
  const onDms = byId(entries.connections.get(entries.dmsId) ?? []);
  const plan: ConnectionsPlan = {
    moves: [],
    conflicts: [],
    leavingIdsByEntry: new Map(),
    newOnDms: [],
  };
  for (const { id: from } of entries.legacyByPrecedence) {
    for (const [id, declared] of byId(entries.connections.get(from) ?? [])) {
      const current = onDms.get(id);
      if (current !== undefined && !sameConnection(current, declared)) {
        plan.conflicts.push({
          kind: "connection",
          from,
          id,
          legacy: declared,
          dms: current,
        });
        continue;
      }
      if (current === undefined) {
        onDms.set(id, declared);
        plan.newOnDms.push(...declared);
      }
      plan.leavingIdsByEntry.set(
        from,
        (plan.leavingIdsByEntry.get(from) ?? new Set()).add(id),
      );
      plan.moves.push({
        kind: "connection",
        from,
        id,
        declared,
        alreadyOnDms: current !== undefined,
      });
    }
  }
  return plan;
}

interface SettingsPlan {
  moves: Move[];
  conflicts: Conflict[];
  byHand: HeldSetting[];
  newOnDms: Map<DmsKey, DmsValue>;
}

function planSettings(entries: ProjectEntries): SettingsPlan {
  const held = new Map(
    [...entries.dmsSettings].map(([key, value]) => [
      key,
      { value, onDms: true },
    ]),
  );
  const plan: SettingsPlan = {
    moves: [],
    conflicts: [],
    byHand: [],
    newOnDms: new Map(),
  };
  for (const { id: from, settings } of entries.legacyByPrecedence) {
    for (const setting of settings) {
      const current = held.get(setting.key);
      if (current === undefined) {
        const onDms = !entries.unmovable.has(setting.key);
        held.set(setting.key, { value: setting.value, onDms });
        if (onDms) {
          plan.newOnDms.set(setting.key, setting.value);
          plan.moves.push({ kind: "setting", from, setting });
        } else {
          plan.byHand.push({ from, setting });
        }
      } else if (current.onDms && current.value !== setting.value) {
        plan.conflicts.push({
          kind: "setting",
          from,
          setting,
          dms: current.value,
        });
      }
    }
  }
  return plan;
}

function overridesAfterRemoval(
  entries: ProjectEntries,
  removed: ReadonlySet<string>,
  { leavingIdsByEntry, newOnDms }: ConnectionsPlan,
): Map<string, DeclaredConnection[]> {
  const overrides = new Map<string, DeclaredConnection[]>();
  const keep = (module: string, connection: DeclaredConnection) => {
    overrides.set(module, [...(overrides.get(module) ?? []), connection]);
  };
  for (const [module, declared] of entries.connections) {
    for (const connection of declared) {
      if (
        removed.has(bindingKey(connection)) &&
        !leavingIdsByEntry.get(module)?.has(connection.id)
      ) {
        keep(module, connection);
      }
    }
  }
  for (const connection of newOnDms) keep(entries.dmsId, connection);
  return overrides;
}

function configOf(
  settings: ReadonlyMap<DmsKey, DmsValue>,
): ConfigObject | undefined {
  if (settings.size === 0) return undefined;
  const sections = new Map<string, ConfigObject>();
  for (const [key, value] of settings) {
    const [section, name] = DMS_PATHS[key];
    sections.set(section, { ...sections.get(section), [name]: value });
  }
  return Object.fromEntries(sections);
}

function stepsOf(
  entries: ProjectEntries,
  connections: ConnectionsPlan,
  settings: SettingsPlan,
): ProjectConfigStep[] {
  const leaving = [...connections.leavingIdsByEntry].flatMap(([from, ids]) =>
    (entries.connections.get(from) ?? []).filter(({ id }) => ids.has(id)),
  );
  const removals = new Map(
    leaving.map((connection) => [bindingKey(connection), connection]),
  );
  const steps: ProjectConfigStep[] = [...removals.values()].map(
    ({ interface: interfaceId, id }) => ({
      op: "RemoveConnection",
      interface: interfaceId,
      id,
    }),
  );
  const overrides = overridesAfterRemoval(
    entries,
    new Set(removals.keys()),
    connections,
  );
  const dmsOverrides = overrides.get(entries.dmsId);
  overrides.delete(entries.dmsId);
  for (const [id, importOverrides] of overrides) {
    steps.push({ op: "ConfigureModule", id, entry: { importOverrides } });
  }
  const dms: ModuleEntryInput = {};
  if (dmsOverrides !== undefined) dms.importOverrides = dmsOverrides;
  const config = configOf(settings.newOnDms);
  if (config !== undefined) dms.config = config;
  if (dms.importOverrides !== undefined || dms.config !== undefined) {
    steps.push({ op: "ConfigureModule", id: entries.dmsId, entry: dms });
  }
  return steps;
}

const NO_CONNECTIONS: ConnectionsPlan = {
  moves: [],
  conflicts: [],
  leavingIdsByEntry: new Map(),
  newOnDms: [],
};

export function planMove(entries: ProjectEntries): MovePlan {
  const connections = planConnections(entries);
  const settings = planSettings(entries);
  const moving = entries.holdConnections ? NO_CONNECTIONS : connections;
  return {
    steps: stepsOf(entries, moving, settings),
    moves: [...moving.moves, ...settings.moves],
    heldConnectionMoves: entries.holdConnections ? connections.moves : [],
    conflicts: [...connections.conflicts, ...settings.conflicts],
    byHand: settings.byHand,
    leaving: moving.leavingIdsByEntry,
    dmsAfter: new Map([...entries.dmsSettings, ...settings.newOnDms]),
  };
}
