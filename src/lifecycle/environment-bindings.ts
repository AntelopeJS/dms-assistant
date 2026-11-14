import { readFile } from "node:fs/promises";
import path from "node:path";
import type * as TypeScript from "typescript";

type Ts = typeof TypeScript;

const CONFIG_FILE = "antelope.config.ts";
const ENVIRONMENTS = "environments";
const MODULES = "modules";
const IMPORT_OVERRIDES = "importOverrides";

/**
 * What `environments.<env>.modules` of the project's `antelope.config.ts` gives the entries asked
 * about: the environments that give each one importOverrides, when the move could read them all.
 */
export type EnvironmentBindings =
  | { readable: true; given: ReadonlyMap<string, readonly string[]> }
  | { readable: false; reason: string };

type Members = Map<string, TypeScript.ObjectLiteralElementLike>;

function nameOf(
  ts: Ts,
  member: TypeScript.ObjectLiteralElementLike,
): string | undefined {
  const { name } = member;
  return name !== undefined &&
    (ts.isIdentifier(name) || ts.isStringLiteralLike(name))
    ? name.text
    : undefined;
}

/** An object literal's members by name, or none when one hides its name, as a spread does. */
function membersOf(
  ts: Ts,
  node: TypeScript.Node | undefined,
): Members | undefined {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) {
    return undefined;
  }
  const members: Members = new Map();
  for (const member of node.properties) {
    const name = nameOf(ts, member);
    if (name === undefined) return undefined;
    members.set(name, member);
  }
  return members;
}

function valueOf(
  ts: Ts,
  member: TypeScript.ObjectLiteralElementLike | undefined,
): TypeScript.Expression | undefined {
  return member !== undefined && ts.isPropertyAssignment(member)
    ? member.initializer
    : undefined;
}

/** The object @antelopejs/dms reads as the configuration: the default export, or its call's first argument. */
function configObject(
  ts: Ts,
  file: TypeScript.SourceFile,
): TypeScript.ObjectLiteralExpression | undefined {
  const [exported] = file.statements.flatMap((statement) =>
    ts.isExportAssignment(statement) && !statement.isExportEquals
      ? [statement.expression]
      : [],
  );
  const config =
    exported !== undefined && ts.isCallExpression(exported)
      ? exported.arguments[0]
      : exported;
  return config !== undefined && ts.isObjectLiteralExpression(config)
    ? config
    : undefined;
}

/** Whether an entry of `environments.<env>.modules` gives importOverrides, or undefined when unread. */
function binds(
  ts: Ts,
  entry: TypeScript.ObjectLiteralElementLike,
): boolean | undefined {
  const value = valueOf(ts, entry);
  if (value !== undefined && ts.isStringLiteralLike(value)) return false;
  const fields = membersOf(ts, value);
  if (fields === undefined) return undefined;
  if (!fields.has(IMPORT_OVERRIDES)) return false;
  const overrides = valueOf(ts, fields.get(IMPORT_OVERRIDES));
  return !(
    overrides !== undefined &&
    ts.isArrayLiteralExpression(overrides) &&
    overrides.elements.length === 0
  );
}

function givenIn(
  ts: Ts,
  config: TypeScript.ObjectLiteralExpression,
  ids: readonly string[],
): Map<string, string[]> | undefined {
  const members = membersOf(ts, config);
  if (members === undefined) return undefined;
  const given = new Map<string, string[]>();
  if (!members.has(ENVIRONMENTS)) return given;
  const byEnvironment = membersOf(ts, valueOf(ts, members.get(ENVIRONMENTS)));
  if (byEnvironment === undefined) return undefined;
  for (const [environment, member] of byEnvironment) {
    const environmentConfig = membersOf(ts, valueOf(ts, member));
    if (environmentConfig === undefined) return undefined;
    if (!environmentConfig.has(MODULES)) continue;
    const modules = membersOf(ts, valueOf(ts, environmentConfig.get(MODULES)));
    if (modules === undefined) return undefined;
    for (const [id, entry] of modules) {
      if (!ids.includes(id)) continue;
      const bound = binds(ts, entry);
      if (bound === undefined) return undefined;
      if (bound) given.set(id, [...(given.get(id) ?? []), environment]);
    }
  }
  return given;
}

/**
 * The environments of the project's `antelope.config.ts` that give each of `ids` importOverrides,
 * or unreadable when the project has no TypeScript or the file does not write them as plain object
 * literals.
 */
export async function environmentBindings(
  projectPath: string,
  ids: readonly string[],
): Promise<EnvironmentBindings> {
  if (ids.length === 0) return { readable: true, given: new Map() };
  let text: string;
  try {
    text = await readFile(path.join(projectPath, CONFIG_FILE), "utf8");
  } catch {
    return { readable: false, reason: "the move could not open it" };
  }
  let ts: Ts;
  try {
    ts = await import("typescript");
  } catch {
    return { readable: false, reason: "the project has no TypeScript" };
  }
  const file = ts.createSourceFile(CONFIG_FILE, text, ts.ScriptTarget.Latest);
  const config = configObject(ts, file);
  const given = config === undefined ? undefined : givenIn(ts, config, ids);
  return given === undefined
    ? {
        readable: false,
        reason:
          "they are not all written there as plain object literals, as with a spread, a variable or an imported base",
      }
    : { readable: true, given };
}
