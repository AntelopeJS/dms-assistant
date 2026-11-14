const CATALOG = "@antelopejs/interface-database-catalog";
const DATABASE = "@antelopejs/interface-database";

/**
 * @param {string} interfaceId
 * @param {string} id
 * @param {string} source
 */
function connection(interfaceId, id, source) {
  return { interface: interfaceId, source, id };
}

/**
 * @param {Record<string, { package: string, config: Record<string, unknown>, importOverrides: { interface: string, source?: string, id?: string }[] }>} entries
 */
function project(entries) {
  return {
    dms: {
      package: "@antelopejs/dms",
      config: { homepage: "/home" },
      importOverrides: [],
    },
    "dms-assistant": {
      package: "@antelopejs/dms-assistant",
      config: {},
      importOverrides: [],
    },
    "dms-database": {
      package: "@antelopejs/dms-database",
      config: { externalConnections: { erp: { access: "read-write" } } },
      importOverrides: [
        { interface: DATABASE, source: "mongodb" },
        connection(DATABASE, "erp", "builder-db-erp"),
        connection(CATALOG, "erp", "builder-db-erp"),
      ],
    },
    mongodb: {
      package: "@antelopejs/mongodb",
      config: {},
      importOverrides: [],
    },
    "builder-db-erp": {
      package: "@antelopejs/postgres",
      config: {},
      importOverrides: [],
    },
    ...entries,
  };
}

/** @param {{ interface: string, source?: string, id?: string }[]} overrides */
function sorted(overrides) {
  return overrides
    .map((item) => JSON.stringify(item, Object.keys(item).toSorted()))
    .toSorted();
}

module.exports = { CATALOG, connection, project, sorted };
