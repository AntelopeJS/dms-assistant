import fs from "node:fs";
import path from "node:path";
import type { ExcludedRelation } from "@antelopejs/interface-dms-builder";
import { z } from "zod";
import { moduleOfFile, targetModule } from "./modules";
import { resolveProjectRoot } from "./project";
import { StepRefusal } from "./project-config";

const MANIFEST = "package.json";

const TextSchema = z.string().optional().catch(undefined);
const RelationReasonsSchema = z
  .record(z.string(), z.string())
  .optional()
  .catch(undefined);

/** What a module bound to an external database records about it in its `package.json`. */
const DatabaseRecordSchema = z.looseObject({
  connection: TextSchema,
  /** Tables decided against, `"schema.name"` → why, so no analysis proposes them again. */
  excludedTables: RelationReasonsSchema,
});

const BuilderManifestSchema = z.looseObject({
  database: DatabaseRecordSchema.optional().catch(undefined),
  /** dms-builder 0.6 and earlier: the connection, read until the next save. */
  mapped: TextSchema,
  /** dms-builder 0.6 and earlier: the excluded tables, read until the next save. */
  excluded: RelationReasonsSchema,
});

/** The builder's keys of a module's `package.json`; one of the wrong type reads as absent. */
const MappedManifestSchema = z
  .looseObject({
    dmsBuilder: BuilderManifestSchema.optional().catch(undefined),
  })
  .catch({});

/**
 * A JSON object as the file holds it, keys in file order, so a save writes back every key it does
 * not own where it was. Anything but an object reads as an empty one.
 */
const JsonObjectSchema = z.record(z.string(), z.json()).catch({});

type MappedManifest = z.infer<typeof MappedManifestSchema>;
type DatabaseRecord = z.infer<typeof DatabaseRecordSchema>;
type JsonObject = z.infer<typeof JsonObjectSchema>;

/** What one `MapResources` call changes in the module's record. */
export interface MappedRecordUpdate {
  connection: string;
  mapped: string[];
  excluded: ExcludedRelation[];
}

function manifestPath(root: string): string {
  return path.join(root, MANIFEST);
}

const BYTE_ORDER_MARK = /^\uFEFF/;

/** A module's manifest as written; refused, naming the file, when it is not JSON. */
function readManifestFile(root: string): JsonObject {
  const file = manifestPath(root);
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    return JsonObjectSchema.parse(
      JSON.parse(fs.readFileSync(file, "utf8").replace(BYTE_ORDER_MARK, "")),
    );
  } catch (error) {
    throw new StepRefusal(
      `${path.relative(resolveProjectRoot(), file)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The builder's keys of a module's manifest. */
function readManifest(root: string): MappedManifest {
  return MappedManifestSchema.parse(readManifestFile(root));
}

function updatedExclusions(
  current: Record<string, string> | undefined,
  update: MappedRecordUpdate,
): Record<string, string> | undefined {
  const excluded = { ...current };
  for (const relation of update.mapped) {
    delete excluded[relation];
  }
  for (const entry of update.excluded) {
    excluded[entry.relation] = entry.reason;
  }
  return Object.keys(excluded).length > 0 ? excluded : undefined;
}

function databaseRecord(manifest: MappedManifest): DatabaseRecord {
  const builder = manifest.dmsBuilder;
  return {
    connection: builder?.database?.connection ?? builder?.mapped,
    excludedTables: builder?.database?.excludedTables ?? builder?.excluded,
  };
}

function recorded(manifest: JsonObject, record: DatabaseRecord): JsonObject {
  const {
    mapped: _mapped,
    excluded: _excluded,
    ...builder
  } = JsonObjectSchema.parse(manifest.dmsBuilder);
  const database: JsonObject = {};
  if (record.connection !== undefined) {
    database.connection = record.connection;
  }
  if (record.excludedTables && Object.keys(record.excludedTables).length > 0) {
    database.excludedTables = record.excludedTables;
  }
  return { ...manifest, dmsBuilder: { ...builder, database } };
}

function manifestText(manifest: JsonObject): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function writeDatabaseRecord(root: string, record: DatabaseRecord): void {
  const manifest = readManifestFile(root);
  const next = recorded(manifest, record);
  if (JSON.stringify(next) === JSON.stringify(manifest)) {
    return;
  }
  fs.writeFileSync(manifestPath(root), manifestText(next));
}

/** The connection a module folder's record names, when the builder mapped tables into it. */
export function recordedConnection(root: string): string | undefined {
  return databaseRecord(readManifest(root)).connection;
}

/**
 * Marks a module as one whose tables mirror a database the project does not own, so the
 * operations that would create, alter or empty a table refuse there, and records which relations
 * were decided against.
 */
export function markMapped(module: string, update: MappedRecordUpdate): void {
  const root = targetModule(module)?.root;
  if (!root) {
    return;
  }
  const current = databaseRecord(readManifest(root));
  writeDatabaseRecord(root, {
    connection: update.connection,
    excludedTables: updatedExclusions(current.excludedTables, update),
  });
}

/** The connection the module holding a file mirrors, when that module is a mapped one. */
export function mappedConnectionOfFile(filepath: string): string | undefined {
  const root = moduleOfFile(filepath)?.root;
  return root ? recordedConnection(root) : undefined;
}

/** The relations recorded as decided against in a module, with why. */
export function excludedRelationsOf(module: string): Record<string, string> {
  const root = targetModule(module)?.root;
  return root ? (databaseRecord(readManifest(root)).excludedTables ?? {}) : {};
}
