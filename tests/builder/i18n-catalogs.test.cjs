const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");
const { readLocale } = require("../helpers/page-locales.cjs");

const PLACEHOLDER = /\{[a-zA-Z0-9_]+\}/g;

/**
 * A catalog node read as a message or a group of nodes.
 *
 * @typedef {{ kind: "message", text: string } | { kind: "group", children: Record<string, unknown> }} Node
 */

/** @type {z.ZodType<Node>} */
const NodeSchema = z.union([
  z.string().transform((text) => ({ kind: "message", text })),
  z
    .record(z.string(), z.unknown())
    .transform((children) => ({ kind: "group", children })),
]);

/**
 * @param {unknown} value A catalog node
 * @param {string} prefix The dotted path so far
 * @returns {[string, string][]} Each message's dotted key and its sorted placeholders
 */
function messages(value, prefix = "") {
  const node = NodeSchema.parse(value);
  if (node.kind === "message") {
    const holes = [...new Set(node.text.match(PLACEHOLDER) ?? [])].sort();
    return [[prefix, holes.join()]];
  }
  return Object.entries(node.children).flatMap(([key, child]) =>
    messages(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

const en = readLocale("builder-en-GB.json");
const fr = readLocale("builder-fr-FR.json");

void test("both builder catalogs hold only the dms_builder namespace", () => {
  assert.deepEqual(Object.keys(en), ["dms_builder"]);
  assert.deepEqual(Object.keys(fr), ["dms_builder"]);
});

void test("the French builder catalog has every English key with the same placeholders, and no other key (fails a message added in one language only)", () => {
  const english = new Map(messages(en.dms_builder));
  const french = new Map(messages(fr.dms_builder));
  assert.deepEqual([...french.keys()].sort(), [...english.keys()].sort());
  assert.deepEqual(
    [...english].filter(([key, holes]) => french.get(key) !== holes),
    [],
  );
});

void test("no builder message key holds an @, which vue-i18n reads as a link", () => {
  assert.deepEqual(
    messages(en.dms_builder)
      .map(([key]) => key)
      .filter((key) => key.includes("@")),
    [],
  );
});
