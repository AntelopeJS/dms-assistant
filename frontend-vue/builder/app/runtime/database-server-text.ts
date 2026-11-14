import type { OpenItem } from './database-types'
import { t } from './i18n'

/**
 * What the analysis words in English, read in the active locale. A question the builder can
 * rebuild from its item is translated; any other text the server sends is shown as sent.
 */

/** The schemas question counts the tables its options stand for, as `schema (count)` titles. */
function tablesBehind(item: OpenItem): number {
	return item.options.reduce((total, option) => total + Number(/\((\d+)\)$/.exec(option.title)?.[1] ?? 0), 0)
}

/** The text an open item asks, in the active locale when the builder can word it from the item alone. */
export function questionText(item: OpenItem): string {
	const relation = item.relation ?? ''
	switch (item.kind) {
		case 'schemas':
			return t('database.server.schemas', { count: tablesBehind(item) })
		case 'label':
			return t('database.server.label', { relation })
		case 'purpose':
			return t('database.server.purpose', { relation })
		default:
			return item.question
	}
}
