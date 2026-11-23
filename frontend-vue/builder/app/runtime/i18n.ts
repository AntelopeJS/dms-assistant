import { useDmsApp } from '#dms/frontend-module'

/**
 * The builder's own messages, under one namespace of the app's catalog.
 *
 * The DMS frontend loader merges every module's `i18n/locales/*-xx-XX.json`
 * into the application's messages, so the module ships its texts the way any
 * DMS layer does — `builder-en-GB.json`, `builder-fr-FR.json` — and reads them
 * back through the host's composer. English is the fallback locale: a key a
 * translation lacks still reads as English.
 */
const I18N_NAMESPACE = 'dms_builder'

type MessageParams = Record<string, string | number>

/**
 * A builder message in the active locale. `count` picks the plural form of a
 * message written as `one | many`; it is passed as `{count}` too.
 *
 * It reads the application's composer on every call, so a text drawn in a
 * render follows a language switch.
 */
export function t(key: string, params: MessageParams = {}, count?: number): string {
	const { $i18n } = useDmsApp()
	const path = `${I18N_NAMESPACE}.${key}`
	return count === undefined
		? $i18n.t(path, params)
		: $i18n.t(path, { count, ...params }, count)
}
