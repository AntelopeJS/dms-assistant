/**
 * Stand-in for the host runtime the DMS frontend loader materializes as
 * `#dms/frontend-module`. Only what this package imports from the host is
 * declared.
 *
 * @packageDocumentation
 */
import englishMessages from '../../../i18n/locales/builder-en-GB.json'
import frenchMessages from '../../../i18n/locales/builder-fr-FR.json'

type Messages = { [key: string]: string | Messages }

function isText(node: string | Messages): node is string {
  return typeof node === 'string'
}

function flatten(messages: Messages, prefix: string): [string, string][] {
  return Object.entries(messages).flatMap(([key, node]) =>
    isText(node) ? [[`${prefix}${key}`, node]] : flatten(node, `${prefix}${key}.`),
  )
}

const ENGLISH = new Map(flatten(englishMessages, ''))
const FRENCH = new Map(flatten(frenchMessages, ''))

/** vue-i18n's default choice: `zero | one | many`, or `one | many`. */
function pluralForm(message: string, count: number | undefined): string {
  const forms = message.split(' | ')
  if (count === undefined || forms.length === 1) {
    return message
  }
  const index =
    forms.length === 2 ? (count === 1 ? 0 : 1) : Math.min(Math.abs(count), 2)
  return forms[index] ?? message
}

export type TestLocale = 'en-GB' | 'fr-FR'

let locale: TestLocale = 'en-GB'

/** Switches the locale `translate` reads; a test restores `en-GB` when it is done. */
export function setTestLocale(next: TestLocale): void {
  locale = next
}

/**
 * The application composer, reading the module's catalog in the test locale,
 * English unless a test switches it: a test asserts the texts an
 * English-speaking author sees, and a key the catalog lacks comes back as
 * itself, as vue-i18n returns it.
 */
function translate(
  key: string,
  params: Record<string, string | number> = {},
  count?: number,
): string {
  const message =
    (locale === 'fr-FR' ? FRENCH : ENGLISH).get(key) ?? ENGLISH.get(key)
  if (message === undefined) {
    return key
  }
  return pluralForm(message, count).replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  )
}

export function useDmsApp() {
  return { $i18n: { t: translate } }
}
