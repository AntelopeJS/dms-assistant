import fs from "node:fs";
import os from "node:os";
import Module from "node:module";
import path from "node:path";
import { expect } from "chai";

const CATALOG_INTERFACE = "@antelopejs/interface-database-catalog";
const INTERFACE_CORE = "@antelopejs/interface-core";
const BUILDER = "dms-builder";
const HTTP_MODULE = "api";
const ENGINE = path.join(
  __dirname,
  "..",
  "implementations",
  "dms-builder",
  "engine",
);
const CONNECTION_MODULE = path.join(ENGINE, "catalog-connection.js");
/** A provider module of the catalog interface, exporting each of its functions. */
const CATALOG_PROVIDER = [
  "Info",
  "ListRelations",
  "DescribeRelations",
  "Profile",
  "CheckReference",
  "SampleRows",
]
  .map((name) => `exports.${name} = async () => undefined;\n`)
  .join("");
const RELOADED = [CONNECTION_MODULE, path.join(ENGINE, "own-connections.js")];

/** The async module context, as the runtime sets it: the builder while it loads, then the HTTP module. */
const context = { module: BUILDER };

/** interface-core as 0.2.5 answers: connections belong to the module of the current context. */
function interfaceCore(catalogPath: string) {
  return {
    GetResponsibleModule: () => context.module,
    RunWithResponsibleModule: <T>(module: string, callback: () => T): T => {
      const previous = context.module;
      context.module = module;
      try {
        return callback();
      } finally {
        context.module = previous;
      }
    },
    GetInterfaceInstances: (interfaceId: string) =>
      context.module === BUILDER && interfaceId === CATALOG_INTERFACE
        ? [{ id: "erp", path: catalogPath, provider: "postgres-erp" }]
        : [],
  };
}

type ConnectionModule = Awaited<
  typeof import("../implementations/dms-builder/engine/catalog-connection")
>;

/**
 * Loads the connection module afresh, in the builder's context, with interface-core answered by
 * a stub that sits in the require cache under the path the engine resolves it to.
 */
async function loadInBuilderContext(
  catalogPath: string,
): Promise<ConnectionModule> {
  const corePath = require.resolve(INTERFACE_CORE, { paths: [ENGINE] });
  const original = require.cache[corePath];
  const stub = new Module(corePath);
  stub.filename = corePath;
  stub.exports = interfaceCore(catalogPath);
  stub.loaded = true;
  require.cache[corePath] = stub;
  RELOADED.forEach((file) => delete require.cache[file]);
  try {
    context.module = BUILDER;
    return await import("../implementations/dms-builder/engine/catalog-connection");
  } finally {
    if (original === undefined) delete require.cache[corePath];
    else require.cache[corePath] = original;
    RELOADED.forEach((file) => delete require.cache[file]);
  }
}

/**
 * A route handler runs in the context of the module serving HTTP, so the builder's connections
 * are looked up in its own context, the one it was loaded in.
 */
describe("the builder's catalog connections", () => {
  let directory: string;
  let catalogPath: string;
  let connections: ConnectionModule;

  before(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-connection-"));
    catalogPath = path.join(directory, "catalog.js");
    fs.writeFileSync(catalogPath, CATALOG_PROVIDER);
    connections = await loadInBuilderContext(catalogPath);
    context.module = HTTP_MODULE;
  });

  after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    context.module = BUILDER;
  });

  it("lists the builder's connections while a request runs in the HTTP module's context", () => {
    expect(connections.listCatalogConnections()).to.deep.equal(["erp"]);
    expect(context.module).to.equal(HTTP_MODULE);
  });

  it("reaches a connection's catalog from that context", () => {
    expect(connections.catalogOf("erp")).to.equal(require(catalogPath));
    expect(connections.catalogOf("crm")).to.equal(undefined);
  });
});
