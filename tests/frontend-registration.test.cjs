const assert = require("node:assert/strict");
const { z } = require("zod");
const path = require("node:path");
const { test } = require("node:test");
const { Component } = require("@antelopejs/interface-dms/component");
const { interceptRequire } = require("./helpers/intercept-require.cjs");
const {
  LocaleSchema,
  PAGE_LOCALES,
  readLocale,
} = require("./helpers/page-locales.cjs");

/**
 * @typedef {import("@antelopejs/interface-dms/page").ModuleInfo} ModuleInfo
 * @typedef {import("@antelopejs/interface-dms/page").MenuOptions} MenuOptions
 * @typedef {import("@antelopejs/interface-dms/component").Component} PageComponent
 * @typedef {import("@antelopejs/interface-dms/component").ComponentInfo} ComponentInfo
 * @typedef {import("@antelopejs/interface-dms/component").ComponentMetadata} ComponentMetadata
 * @typedef {import("./helpers/page-locales.cjs").LocaleNode} LocaleNode
 */

const I18N_KEY = /\$dms_ai\.[A-Za-z0-9_.-]+/g;
const MODULE_PAGES = ["settings", "changes", "activity"];

/**
 * @param {{ [key: string]: LocaleNode }} locale - A page locale.
 * @param {string} key - A `$`-prefixed dotted key.
 * @returns {LocaleNode | undefined} The node the key leads to, if the locale holds one.
 */
function translate(locale, key) {
  /** @type {LocaleNode | undefined} */
  let node = locale;
  for (const part of key.slice(1).split(".")) {
    const group = LocaleSchema.safeParse(node);
    node = group.success ? group.data[part] : undefined;
  }
  return node;
}

const TextSchema = z.string();

/**
 * @param {{ [key: string]: LocaleNode }} locale - A page locale.
 * @param {string} key - A `$`-prefixed dotted key.
 */
function isTranslated(locale, key) {
  return TextSchema.safeParse(translate(locale, key)).success;
}

/**
 * @param {string} id - Id of the page.
 * @param {MenuOptions} menu - Menu entry of the page.
 * @param {ComponentInfo | undefined} layout - Layout of the page.
 */
function pageController(id, menu, layout) {
  class Page {}
  Page.pageId = id;
  Page.menu = menu;
  Page.layout = layout;
  return Page;
}

/**
 * A page class as the AI module registers it: the id, menu and layout come
 * from the controller base, and its own enumerable statics are its components.
 *
 * @typedef {ReturnType<typeof pageController>} RegisteredPage
 */

function loadPages() {
  /** @type {{ modules: ModuleInfo[]; pages: RegisteredPage[] }} */
  const registered = { modules: [], pages: [] };
  const pageApi = {
    /** @param {ModuleInfo} info - The module being registered. */
    RegisterModule: (info) => registered.modules.push(info),
    RegisterPage:
      () =>
      /** @param {RegisteredPage} target - The page class being registered. */
      (target) => {
        registered.pages.push(target);
      },
    PageController: pageController,
  };
  const restoreRequire = interceptRequire(
    { "@antelopejs/interface-dms/page": pageApi },
    false,
    module,
  );
  try {
    for (const file of Object.keys(require.cache)) {
      if (file.includes(`${path.sep}dist${path.sep}pages`)) {
        delete require.cache[file];
      }
    }
    require("../dist/pages/index.js");
  } finally {
    restoreRequire();
  }
  return registered;
}

const ComponentSchema = z.instanceof(Component);

/**
 * @param {RegisteredPage} page - A registered page.
 * @returns {[string, PageComponent][]} The own static fields of the page that are components, by name.
 */
function staticComponents(page) {
  return Object.entries(page).flatMap((entry) => {
    const component = ComponentSchema.safeParse(entry[1]);
    return component.success ? [[entry[0], component.data]] : [];
  });
}

/**
 * @param {RegisteredPage} page - A registered page.
 * @param {string} field - Name of the static field.
 */
function staticComponent(page, field) {
  const found = staticComponents(page).find(([key]) => key === field);
  assert.ok(found, `${page.pageId} declares ${field}`);
  return found[1];
}

/**
 * @typedef {{ path: string; metadata: ComponentMetadata }} Position
 */

/**
 * @param {string} prefix - Path of the component.
 * @param {PageComponent} component - The component to visit, then its children.
 * @param {Position[]} positions - Receives each position visited.
 */
async function collectPositions(prefix, component, positions) {
  positions.push({ path: prefix, metadata: component.metadata });
  const info = await component.componentInfo;
  for (const child of info.children ?? []) {
    await collectPositions(`${prefix}.${child.id}`, child.component, positions);
  }
}

const ContainerSchema = z.union([
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

/**
 * @param {unknown} value - A node of a serialized tree.
 * @param {Set<string>} keys - Receives each `$dms_ai` key found.
 */
function collectKeys(value, keys) {
  const text = TextSchema.safeParse(value);
  if (text.success) {
    for (const match of text.data.matchAll(I18N_KEY)) keys.add(match[0]);
    return;
  }
  const container = ContainerSchema.safeParse(value);
  if (container.success) {
    for (const entry of Object.values(container.data)) {
      collectKeys(entry, keys);
    }
  }
}

const OrderSchema = z.number();

void test("registers the three AI pages, in order, with translated menu entries", () => {
  const { modules, pages } = loadPages();
  assert.equal(modules.length, 1);
  assert.equal(modules[0].id, "ai");
  assert.equal(modules[0].landingPage, "settings");
  const sorted = [...pages].sort(
    (a, b) => OrderSchema.parse(a.menu.order) - OrderSchema.parse(b.menu.order),
  );
  assert.deepEqual(
    sorted.map((page) => page.pageId),
    MODULE_PAGES,
  );
  for (const page of pages) {
    assert.equal(page.menu.module, "ai");
    assert.match(page.menu.displayName, /^\$dms_ai\.pages\./);
    assert.match(page.menu.description ?? "", /^\$dms_ai\.pages\./);
    assert.ok(page.menu.icon, `${page.pageId} has an icon`);
  }
});

void test("titles every block and child of the AI pages for the role editor", async () => {
  const { pages } = loadPages();
  const locales = PAGE_LOCALES.map(readLocale);
  for (const page of pages) {
    /** @type {Position[]} */
    const positions = [];
    for (const [key, component] of staticComponents(page)) {
      await collectPositions(`${page.pageId}.${key}`, component, positions);
    }
    assert.ok(positions.length > 0, `${page.pageId} declares blocks`);
    for (const { path: where, metadata } of positions) {
      assert.match(metadata.name, /^\$dms_ai\.blocks\./, where);
      const description = metadata.description ?? "";
      assert.match(description, /^\$dms_ai\.blocks\./, where);
      assert.ok(metadata.icon, `${where} has an icon`);
      for (const locale of locales) {
        assert.ok(isTranslated(locale, metadata.name), where);
        assert.ok(isTranslated(locale, description), where);
      }
    }
  }
});

void test("translates every $dms_ai key the AI pages serve, in English and French", async () => {
  const { modules, pages } = loadPages();
  /** @type {Set<string>} */
  const keys = new Set();
  collectKeys(modules, keys);
  for (const page of pages) {
    collectKeys(page.menu, keys);
    collectKeys(page.layout, keys);
    for (const [, component] of staticComponents(page)) {
      collectKeys(await component.serialize(), keys);
    }
  }
  assert.ok(keys.size > 0);
  for (const file of PAGE_LOCALES) {
    const locale = readLocale(file);
    const missing = [...keys].filter((key) => !isTranslated(locale, key));
    assert.deepEqual(missing, [], file);
  }
});

const COMPONENT_PREFIX = "DmsAi";
const CUSTOM_COMPONENT = /"(DmsAi[A-Z][A-Za-z]+)"/g;
const COMPONENTS_DIR = path.resolve(
  __dirname,
  "../frontend-vue/app/components",
);
/** What no DMS block draws: the Changes view and the Activity row drawer. */
const PAGE_CUSTOM_COMPONENTS = ["DmsAiActivityDetail", "DmsAiChangesView"];

void test("names only the custom components the frontend registers, where no DMS block fits", async () => {
  const { pages } = loadPages();
  /** @type {Set<string>} */
  const names = new Set();
  for (const page of pages) {
    for (const [, component] of staticComponents(page)) {
      const serialized = JSON.stringify(await component.serialize());
      for (const match of serialized.matchAll(CUSTOM_COMPONENT)) {
        names.add(match[1]);
      }
    }
  }
  assert.deepEqual(
    [...names].sort((left, right) => left.localeCompare(right)),
    PAGE_CUSTOM_COMPONENTS,
  );
  for (const name of names) {
    const file = `${name.slice(COMPONENT_PREFIX.length)}.vue`;
    assert.ok(
      require("node:fs").existsSync(path.join(COMPONENTS_DIR, file)),
      `${name} is registered from ${file}`,
    );
  }
});

const PeriodSchema = z.looseObject({
  options: z.looseObject({
    id: z.unknown().optional(),
    rememberKey: z.unknown().optional(),
    rangeLabel: z.unknown().optional(),
    variant: z.unknown().optional(),
    presets: z.unknown().optional(),
    defaultPreset: z.unknown().optional(),
    comparisons: z.unknown().optional(),
    defaultComparison: z.unknown().optional(),
    comparisonControl: z.unknown().optional(),
  }),
});

const LogSchema = z.looseObject({
  options: z.looseObject({
    source: z.looseObject({ periodScope: z.unknown().optional() }),
  }),
});

/** @param {RegisteredPage} page - A registered page. */
async function toolbarPeriod(page) {
  const [firstKey, toolbar] = staticComponents(page)[0];
  const info = await toolbar.componentInfo;
  const children = info.children ?? [];
  const period = children.find((child) => child.id === "period");
  assert.ok(period, `${page.pageId} toolbar has a period`);
  return {
    firstKey,
    toolbar: await toolbar.serialize(),
    childIds: children.map((child) => child.id),
    period: PeriodSchema.parse(await period.component.serialize()),
  };
}

/**
 * @param {RegisteredPage[]} pages - The registered pages.
 * @param {string} id - Id of the page to find.
 */
function findPage(pages, id) {
  const page = pages.find((candidate) => candidate.pageId === id);
  assert.ok(page, `${id} is registered`);
  return page;
}

void test("opens the Activity page with the DMS page toolbar, its period only", async () => {
  const { pages } = loadPages();
  const { firstKey, toolbar, childIds, period } = await toolbarPeriod(
    findPage(pages, "activity"),
  );
  assert.equal(firstKey, "toolbar");
  assert.equal(toolbar.componentName, "dms-page-toolbar-block");
  assert.deepEqual(childIds, ["period"]);
  assert.equal(period.options.rememberKey, "ai");
  assert.equal(period.options.rangeLabel, "relative");
  assert.equal(period.options.variant, "segmented");
});

void test("scopes the audit log to the Activity period, the whole log by default", async () => {
  const { pages } = loadPages();
  const activity = findPage(pages, "activity");
  const { period } = await toolbarPeriod(activity);
  assert.equal(period.options.id, "ai-activity");
  assert.equal(period.options.defaultPreset, "all");
  assert.deepEqual(period.options.comparisons, ["none"]);
  const log = LogSchema.parse(
    await staticComponent(activity, "log").serialize(),
  );
  assert.equal(log.options.source.periodScope, "ai-activity");
});
