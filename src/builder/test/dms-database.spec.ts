import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import { setModuleConfig } from "../config";
import { dmsDatabaseId } from "../implementations/dms-builder/engine/dms-database";

const DMS_DATABASE_PACKAGE = "@antelopejs/dms-database";

function config(modules: string): string {
  return `import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "detection",
  modules: {
    mongodb: { source: { type: "package", package: "@antelopejs/mongodb", version: "*" } },
${modules}
  },
});
`;
}

let root: string;

function writeConfig(modules: string): void {
  fs.writeFileSync(path.join(root, "antelope.config.ts"), config(modules));
}

function writeManifest(folder: string, name: string): void {
  fs.mkdirSync(path.join(root, folder), { recursive: true });
  fs.writeFileSync(
    path.join(root, folder, "package.json"),
    JSON.stringify({ name }),
  );
}

/**
 * dms-database lists the connections registered on its own entry, so the builder has to find that
 * entry however the project keyed it: by the module's id, by the package it installs, or by the
 * name of a local checkout.
 */
describe("the entry that is dms-database", () => {
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dms-builder-dms-database-"));
    setModuleConfig({ projectRoot: root });
  });

  after(() => {
    setModuleConfig();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("is the module with the id dms-database", () => {
    writeConfig(
      `    "dms-database": { source: { type: "package", package: "x", version: "*" } },`,
    );
    expect(dmsDatabaseId()).to.equal("dms-database");
  });

  it("is found by the package its source installs, under any id", () => {
    writeConfig(
      `    "@antelopejs/dms-database": { source: { type: "package", package: "${DMS_DATABASE_PACKAGE}", version: "*" } },`,
    );
    expect(dmsDatabaseId()).to.equal("@antelopejs/dms-database");
  });

  it("is found by the name in the package.json of its local source", () => {
    writeManifest("vendor/console", DMS_DATABASE_PACKAGE);
    writeConfig(
      `    console: { source: { type: "local", path: "vendor/console" } },`,
    );
    expect(dmsDatabaseId()).to.equal("console");
  });

  it("is not a local module only because its folder is named after dms-database", () => {
    writeManifest("vendor/dms-database", "@acme/console");
    writeConfig(
      `    console: { source: { type: "local", path: "vendor/dms-database" } },`,
    );
    expect(dmsDatabaseId()).to.equal(undefined);
  });

  it("is not a local module whose folder has no package.json", () => {
    writeConfig(
      `    console: { source: { type: "local", path: "vendor/missing" } },`,
    );
    expect(dmsDatabaseId()).to.equal(undefined);
  });

  it("is nothing when the project has no dms-database", () => {
    writeConfig(`    app: { source: { type: "local", path: "." } },`);
    expect(dmsDatabaseId()).to.equal(undefined);
  });

  it("is not an entry the builder cannot read as a literal", () => {
    writeConfig(`    "dms-database": DMS_DATABASE_ENTRY,`);
    expect(dmsDatabaseId()).to.equal(undefined);
  });
});
