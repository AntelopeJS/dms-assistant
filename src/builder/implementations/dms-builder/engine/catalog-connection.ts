import type { InterfaceConnection } from "@antelopejs/interface-core";
import type * as Catalog from "@antelopejs/interface-database-catalog";
import { CATALOG_INTERFACE } from "./interface-ids";
import { ownConnections } from "./own-connections";

function catalogConnections(): InterfaceConnection[] {
  return ownConnections(CATALOG_INTERFACE);
}

/** The catalog functions of one connection, as its provider answers them. */
export type CatalogConnection = Pick<
  typeof Catalog,
  | "Info"
  | "ListRelations"
  | "DescribeRelations"
  | "Profile"
  | "CheckReference"
  | "SampleRows"
>;

/**
 * Whether a provider's module exports every catalog function. Their signatures cannot be read at
 * run time, so a module that exports functions under these names is taken at its interface's word.
 */
function isCatalogConnection(exported: unknown): exported is CatalogConnection {
  return (
    typeof exported === "object" &&
    exported !== null &&
    "Info" in exported &&
    typeof exported.Info === "function" &&
    "ListRelations" in exported &&
    typeof exported.ListRelations === "function" &&
    "DescribeRelations" in exported &&
    typeof exported.DescribeRelations === "function" &&
    "Profile" in exported &&
    typeof exported.Profile === "function" &&
    "CheckReference" in exported &&
    typeof exported.CheckReference === "function" &&
    "SampleRows" in exported &&
    typeof exported.SampleRows === "function"
  );
}

type CatalogResolver = (id: string) => CatalogConnection | undefined;
type ConnectionLister = () => string[];

function declaredConnections(): string[] {
  return catalogConnections()
    .map((connection) => connection.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function declaredCatalog(id: string): CatalogConnection | undefined {
  const connection = catalogConnections().find(
    (candidate) => candidate.id === id,
  );
  if (!connection) return undefined;
  const exported: unknown = require(connection.path);
  return isCatalogConnection(exported) ? exported : undefined;
}

let listConnectionIds: ConnectionLister = declaredConnections;
let resolveCatalog: CatalogResolver = declaredCatalog;

/**
 * The catalog connections the project declares for dms-builder: `importOverrides` entries of
 * `@antelopejs/interface-database-catalog` with an id on the builder's module entry.
 */
export function listCatalogConnections(): string[] {
  return listConnectionIds();
}

/** The catalog of one of the builder's connections; nothing for an unknown one. */
export function catalogOf(id: string): CatalogConnection | undefined {
  return resolveCatalog(id);
}

async function notSupplied(): Promise<never> {
  throw new Error("this catalog function is not supplied by the spec");
}

/** A spec's catalog under the functions it supplies: each one it leaves out refuses. */
const UNSUPPLIED_CATALOG: CatalogConnection = {
  Info: notSupplied,
  ListRelations: notSupplied,
  DescribeRelations: notSupplied,
  Profile: notSupplied,
  CheckReference: notSupplied,
  SampleRows: notSupplied,
};

/** Replaces the declared connections, for specs that run without a provider. */
export function setCatalogConnectionsForTests(
  catalogs?: Record<string, Partial<CatalogConnection>>,
): void {
  listConnectionIds = catalogs
    ? () => Object.keys(catalogs)
    : declaredConnections;
  resolveCatalog = catalogs
    ? (id) =>
        Object.hasOwn(catalogs, id)
          ? { ...UNSUPPLIED_CATALOG, ...catalogs[id] }
          : undefined
    : declaredCatalog;
}
