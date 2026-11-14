const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { realProject } = require("./helpers/real-project.cjs");

const CATALOG = "@antelopejs/interface-database-catalog";
const CRM = `[{ interface: "${CATALOG}", source: "builder-db-crm", id: "crm" }]`;
const HEADER = `import { defineConfig } from "@antelopejs/interface-core/config";`;

const MODULES = `{
    dms: {
      source: { type: "package", package: "@antelopejs/dms", version: "^0.19.0" },
    },
    "dms-assistant": {
      source: { type: "package", package: "@antelopejs/dms-assistant", version: "^0.1.0" },
    },
    "dms-builder": {
      source: { type: "package", package: "@antelopejs/dms-builder", version: "^0.11.0" },
      disabled: true,
      importOverrides: [{ interface: "${CATALOG}", source: "builder-db-erp", id: "erp" }],
    },
    "builder-db-erp": {
      source: { type: "package", package: "@antelopejs/postgres", version: ">=0.2.6 <0.3.0" },
    },
    "builder-db-crm": {
      source: { type: "package", package: "@antelopejs/postgres", version: ">=0.2.6 <0.3.0" },
    },
  }`;

const IN_PRODUCTION = `{
    production: {
      modules: {
        "dms-assistant": { importOverrides: ${CRM} },
        "dms-builder": { importOverrides: ${CRM} },
      },
    },
  }`;

const LITERAL = `${HEADER}

export default defineConfig({
  name: "app",
  modules: ${MODULES},
  environments: ${IN_PRODUCTION},
});
`;

const UNREAD =
  /^\[dms-ai\] Could not read environments of antelope\.config\.ts: (.+)\. Check by hand the importOverrides that environments\.<env>\.modules gives (.+)\. Move each catalog connection there to the @antelopejs\/dms entry of the same environment\.$/;
const NOT_LITERAL =
  "they are not all written there as plain object literals, as with a spread, a variable or an imported base";
const RESTART =
  " Start the project again for @antelopejs/dms to serve what moved.";

/**
 * @typedef {{ given: string } | { unread: string, named: string } | { none: true }} Expected
 * @typedef {{ files: Record<string, string>, typescript?: boolean, expected: Expected }} Case
 */

/** @type {Record<string, Case>} */
const CASES = {
  "a literal binding": {
    files: { "antelope.config.ts": LITERAL },
    expected: { given: "production" },
  },
  "an entry only disabled or given a version": {
    files: {
      "antelope.config.ts": `${HEADER}

export default defineConfig({
  name: "app",
  modules: ${MODULES},
  environments: {
    production: { modules: { "dms-builder": { disabled: true } } },
    staging: { modules: { "dms-builder": "^0.11.0" } },
  },
});
`,
    },
    expected: { none: true },
  },
  "environments in a variable": {
    files: {
      "antelope.config.ts": `${HEADER}

const ENVIRONMENTS = ${IN_PRODUCTION};

export default defineConfig({ name: "app", modules: ${MODULES}, environments: ENVIRONMENTS });
`,
    },
    expected: { unread: NOT_LITERAL, named: '"dms-builder"' },
  },
  "a spread base": {
    files: {
      "antelope.config.ts": `${HEADER}

const base = { name: "app", modules: ${MODULES} };

export default defineConfig({ ...base, environments: ${IN_PRODUCTION} });
`,
    },
    expected: { unread: NOT_LITERAL, named: '"dms-builder"' },
  },
  "a base imported from another file": {
    files: {
      "base.ts": `export const shared = { name: "app", modules: ${MODULES}, environments: ${IN_PRODUCTION} };
`,
      "antelope.config.ts": `${HEADER}
import { shared } from "./base";

export default defineConfig({ ...shared });
`,
    },
    expected: { unread: NOT_LITERAL, named: '"dms-builder"' },
  },
  "no TypeScript": {
    files: { "antelope.config.ts": LITERAL },
    typescript: false,
    expected: {
      unread: "the project has no TypeScript",
      named: '"dms-builder"',
    },
  },
};

/**
 * @param {string[]} warnings
 * @returns {{ unread: string, named: string }[]}
 */
function unreadWarnings(warnings) {
  return warnings.flatMap((warning) => {
    const unread = UNREAD.exec(warning);
    return unread === null ? [] : [{ unread: unread[1], named: unread[2] }];
  });
}

/**
 * Fails on a move that reads an `environments` it cannot see as holding no binding: one written
 * after a spread or an imported base, which core still applies, one held in a variable, or any
 * without the project's TypeScript; on one that says an environment gives bindings it never read;
 * on one that counts an entry an environment only disables or gives a version as holding a binding;
 * on one that names dms-assistant's own entry, which the upgrade keeps; or on one that calls
 * dms-builder safe to remove while an environment gives it a binding or could not be read.
 */
void test("only a binding read in environments keeps a legacy entry, and an environments the move cannot read is named and keeps every one", async () => {
  for (const [name, { files, typescript, expected }] of Object.entries(CASES)) {
    const app = realProject(files["antelope.config.ts"] ?? "", {
      typescript,
    });
    for (const [file, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(app.dir, file), text);
    }
    await app.start();
    const [verdict, ...more] = app.verdicts();
    assert.deepEqual(more, [], name);
    if ("unread" in expected) {
      assert.deepEqual(unreadWarnings(app.warnings()), [expected], name);
      assert.equal(verdict?.level, "warn", name);
      assert.match(
        verdict?.line ?? "",
        /^dms-builder: not safe to remove, the move could not read (?:its connections and )?environments of antelope\.config\.ts\./,
        name,
      );
      continue;
    }
    assert.deepEqual(unreadWarnings(app.warnings()), [], name);
    assert.deepEqual(
      verdict,
      "given" in expected
        ? {
            level: "warn",
            line: `dms-builder: the importOverrides of environments.${expected.given} still here, move them before removing.${RESTART}`,
          }
        : {
            level: "info",
            line: `dms-builder: nothing left to move, safe to remove.${RESTART}`,
          },
      name,
    );
  }
});

/**
 * Fails on a move that holds back the top-level move for a binding an environment gives, or that
 * warns about that binding again on every start beside the line of its entry.
 */
void test("the top-level move goes on beside a binding an environment gives, and a second start names it only in the entry's line", async () => {
  const app = realProject(LITERAL);
  await app.start();
  assert.deepEqual(await app.connections("dms"), {
    ok: true,
    data: [
      {
        interface: CATALOG,
        source: "builder-db-erp",
        id: "erp",
        access: "read",
      },
    ],
    changes: [],
  });
  const text = app.text();
  await app.start();
  assert.equal(app.text(), text);
  assert.deepEqual(app.warnings(), []);
  assert.deepEqual(app.verdicts().at(-1), {
    level: "warn",
    line: "dms-builder: the importOverrides of environments.production still here, move them before removing.",
  });
});
