const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");

const LOCALES_DIR = path.resolve(__dirname, "../../frontend-vue/i18n/locales");
const PAGE_LOCALES = [
  "dms-assistant-pages-en-GB.json",
  "dms-assistant-pages-fr-FR.json",
];

/**
 * A node of a locale file: a translated text, or a group of nodes by key.
 *
 * @typedef {string | { [key: string]: LocaleNode }} LocaleNode
 */

/** @type {z.ZodType<LocaleNode>} */
const LocaleNodeSchema = z.lazy(() =>
  z.union([z.string(), z.record(z.string(), LocaleNodeSchema)]),
);

const LocaleSchema = z.record(z.string(), LocaleNodeSchema);

/**
 * A locale of the module's pages, parsed from the frontend's locale files.
 *
 * @param {string} file - File name of the locale in the frontend's locales directory.
 * @returns {{ [key: string]: LocaleNode }} The locale, every node of it a text or a group of nodes.
 */
function readLocale(file) {
  return LocaleSchema.parse(
    JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8")),
  );
}

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

/**
 * @param {{ [key: string]: LocaleNode }} locale - A page locale.
 * @param {string} key - A `$`-prefixed dotted key.
 */
function isTranslated(locale, key) {
  return z.string().safeParse(translate(locale, key)).success;
}

module.exports = { LocaleSchema, PAGE_LOCALES, isTranslated, readLocale };
