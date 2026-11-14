import type {
  DeclaredConnection,
  DmsSettings,
  LegacyEntry,
} from "./builder-settings-plan";
import type { EnvironmentBindings } from "./environment-bindings";

/** What a start carried onto the dms entry, written or not. */
export interface Carried {
  /** Whether the start wrote a batch, which @antelopejs/dms serves only from its next start. */
  wrote: boolean;
  /** The connections of each entry the move read; an entry it could not read has none. */
  connections: ReadonlyMap<string, readonly DeclaredConnection[]>;
  /** The connection ids that left each entry. */
  leaving: ReadonlyMap<string, ReadonlySet<string>>;
  /** The settings the dms entry holds now; none when the move could not read them. */
  dms: DmsSettings;
}

/** Whether a legacy entry the upgrade removes is safe to remove, and why not. */
export interface Verdict {
  id: string;
  /** What the move could not read, so it cannot tell what the entry holds. */
  unread: string[];
  /** What the entry holds that the dms entry does not. */
  left: string[];
}

export function verdictOf(
  entry: LegacyEntry,
  carried: Carried,
  environments: EnvironmentBindings,
): Verdict {
  const read = carried.connections.get(entry.id);
  const leaving = carried.leaving.get(entry.id);
  const remaining = new Set(
    (read ?? []).map(({ id }) => id).filter((id) => !leaving?.has(id)),
  );
  const given = environments.readable
    ? (environments.given.get(entry.id) ?? [])
    : [];
  return {
    id: entry.id,
    unread: [
      ...(read === undefined ? ["its connections"] : []),
      ...(environments.readable ? [] : ["environments of antelope.config.ts"]),
    ],
    left: [
      ...(remaining.size > 0 ? [`${remaining.size} connection(s)`] : []),
      ...entry.settings
        .filter(({ key, value }) => carried.dms.get(key) !== value)
        .map(({ legacyPath }) => legacyPath),
      ...given.map(
        (environment) => `the importOverrides of environments.${environment}`,
      ),
    ],
  };
}

export function isSafe({ unread, left }: Verdict): boolean {
  return unread.length === 0 && left.length === 0;
}
