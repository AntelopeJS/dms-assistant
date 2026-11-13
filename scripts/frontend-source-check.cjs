const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { isRecord, isString } = require("./guards.js");

/** @typedef {string | MessageTree[] | { [key: string]: MessageTree }} MessageTree */

/**
 * @param {unknown} value
 * @returns {value is MessageTree}
 */
function isMessageTree(value) {
  if (isString(value)) return true;
  if (Array.isArray(value)) return value.every(isMessageTree);
  return isRecord(value) && Object.values(value).every(isMessageTree);
}

const frontend = path.resolve(__dirname, "../frontend-vue");
const builder = path.join(frontend, "builder");
const app = path.join(builder, "app");

const NAMESPACE_DECLARATION = /^export const I18N_NAMESPACE = '([\w-]+)'$/m;

/**
 * The database runtime modules, whose texts reach the screen.
 * The prompts sent to an agent live in them too and stay in English: they
 * interpolate values, which this check does not read as a sentence.
 */
const TRANSLATED_RUNTIME = /^runtime\/database[\w-]*\.ts$/;

/** A string literal that reads as a sentence: a capital, then more words. */
const SENTENCE_LITERAL =
  /(['"`])[A-Z][a-z]+(?: (?:(?!\1)[\w.,’'"…:;()-])+)+\1/g;

/** @param {string} relative */
function readText(relative) {
  return fs.readFileSync(path.join(frontend, relative), "utf8");
}

/** @param {string} relative */
function readCatalog(relative) {
  /** @type {unknown} */
  const catalog = JSON.parse(readText(relative));
  if (!isMessageTree(catalog)) {
    throw new Error(`${relative} is not a message catalog`);
  }
  return catalog;
}

/**
 * @param {MessageTree} messages
 * @param {string} [prefix]
 * @returns {Map<string, string>}
 */
function flatten(messages, prefix = "") {
  /** @type {Map<string, string>} */
  const entries = new Map();
  for (const [key, value] of Object.entries(messages)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (isString(value)) {
      entries.set(name, value);
    } else {
      for (const [nested, text] of flatten(value, name)) {
        entries.set(nested, text);
      }
    }
  }
  return entries;
}

/** @param {string} message */
function placeholders(message) {
  return [
    ...new Set([...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1])),
  ].sort((a, b) => a.localeCompare(b));
}

/** @returns {{ name: string, text: string }[]} */
function sources() {
  return fs
    .readdirSync(app, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.(ts|vue)$/.test(name))
    .map((name) => ({
      name,
      text: fs.readFileSync(path.join(app, name), "utf8"),
    }));
}

const namespace = NAMESPACE_DECLARATION.exec(
  readText("builder/app/runtime/i18n.ts"),
)?.[1];
const english = readCatalog("i18n/locales/builder-en-GB.json");
const french = readCatalog("i18n/locales/builder-fr-FR.json");
const en = flatten(english);
const fr = flatten(french);

function catalogsUseTheNamespace() {
  if (namespace === undefined) {
    return ["builder/app/runtime/i18n.ts declares no I18N_NAMESPACE literal"];
  }
  return [
    { file: "builder-en-GB.json", catalog: english },
    { file: "builder-fr-FR.json", catalog: french },
  ]
    .filter(
      ({ catalog }) => !isDeepStrictEqual(Object.keys(catalog), [namespace]),
    )
    .map(
      ({ file, catalog }) =>
        `${file} holds ${JSON.stringify(Object.keys(catalog))}, not only ${namespace}`,
    );
}

/**
 * The builder speaks the author's language: every English message has a
 * French one with the same placeholders, and French has no message English
 * lacks.
 */
function catalogsAreInStep() {
  const failures = [];
  for (const key of en.keys()) {
    if (!fr.has(key)) failures.push(`French lacks ${key}`);
  }
  for (const key of fr.keys()) {
    if (!en.has(key)) failures.push(`English lacks ${key}`);
  }
  for (const [key, message] of en) {
    const expected = placeholders(message);
    const actual = placeholders(fr.get(key) ?? "");
    if (!isDeepStrictEqual(actual, expected)) {
      failures.push(
        `${key} has placeholders ${JSON.stringify(actual)} in French, ${JSON.stringify(expected)} in English`,
      );
    }
  }
  return failures;
}

/**
 * A database sentence left in English in the French catalog: the
 * same words in both, more than one of them. A single word (a product name,
 * `Port`, `Module`) may be the same.
 */
function databaseSentencesAreTranslated() {
  return [...en]
    .filter(
      ([key, message]) =>
        key.startsWith(`${namespace}.database.`) &&
        fr.get(key) === message &&
        /[A-Za-z]{2,}\W+[A-Za-z]{2,}/.test(message.replace(/\{\w+\}/g, "")),
    )
    .map(([key, message]) => `${key} reads the same in French: ${message}`);
}

/** `@` starts a linked message and breaks the compile of the whole text. */
function messagesHaveNoLinkSyntax() {
  return [...en, ...fr]
    .filter(([, message]) => /@/.test(message))
    .map(([key, message]) => `${key} holds @: ${message}`);
}

function codeReadsOnlyCatalogKeys() {
  const missing = [];
  for (const { name, text } of sources()) {
    for (const match of text.matchAll(/\b(?:t|displayKey)\(\s*'([\w.]+)'/g)) {
      if (!en.has(`${namespace}.${match[1]}`)) {
        missing.push(`${name}: ${match[1]}`);
      }
    }
    for (const match of text.matchAll(/\bt\(\s*`([\w.]+)\$\{/g)) {
      const prefix = `${namespace}.${match[1]}`;
      if (![...en.keys()].some((key) => key.startsWith(prefix))) {
        missing.push(`${name}: ${match[1]}…`);
      }
    }
  }
  return missing.map((site) => `the catalog lacks the key read at ${site}`);
}

function toastsAreTranslated() {
  const literal = [];
  for (const { name, text } of sources()) {
    for (const match of text.matchAll(/\bnotify\(\s*(['"`])/g)) {
      literal.push(`${name}: ${text.slice(match.index, match.index + 60)}`);
    }
  }
  return literal.map((site) => `a toast says a literal at ${site}`);
}

/**
 * @param {string} source
 * @returns {string}
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function databaseRuntimeHasNoLiteralText() {
  return sources()
    .filter(({ name }) => TRANSLATED_RUNTIME.test(name.replaceAll("\\", "/")))
    .flatMap(({ name, text }) =>
      [...withoutComments(text).matchAll(SENTENCE_LITERAL)].map(
        (match) => `${name} writes the sentence ${match[0]}`,
      ),
    );
}

const failures = [
  catalogsUseTheNamespace,
  catalogsAreInStep,
  databaseSentencesAreTranslated,
  messagesHaveNoLinkSyntax,
  codeReadsOnlyCatalogKeys,
  toastsAreTranslated,
  databaseRuntimeHasNoLiteralText,
].flatMap((check) => check().map((failure) => `${check.name}: ${failure}`));

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
