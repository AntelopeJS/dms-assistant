import { ref } from "vue";
import type {
	ChatI18n,
	TranslateParams,
} from "../../app/chat/composables/useChatI18n";
import en from "../../i18n/locales/dms-assistant-panel-en-GB.json";

/** A message catalog: strings, nested by the dots of their keys. */
export interface MessageCatalog {
	[name: string]: string | MessageCatalog;
}

const PLURAL_SEPARATOR = " | ";

function isCatalog(
	node: string | MessageCatalog | undefined,
): node is MessageCatalog {
	return node !== undefined && typeof node === "object";
}

function lookup(messages: MessageCatalog, key: string): string | null {
	let node: string | MessageCatalog | undefined = messages;
	for (const part of key.split(".")) {
		if (!isCatalog(node)) return null;
		node = Object.hasOwn(node, part) ? node[part] : undefined;
	}
	return isCatalog(node) ? null : (node ?? null);
}

/** vue-i18n's default choice: two forms are singular/plural, three add zero. */
function choose(forms: string[], count: number): string {
	if (forms.length === 2) return forms[count === 1 ? 0 : 1];
	return forms[Math.min(count, forms.length - 1)];
}

function interpolate(text: string, params: TranslateParams = {}): string {
	return text.replace(/\{(\w+)\}/g, (match, name: string) =>
		Object.hasOwn(params, name) ? String(params[name]) : match,
	);
}

/** The panel's English strings behind the chat's translator, as in the dashboard. */
export function createTestI18n(messages: MessageCatalog = en): ChatI18n {
	return {
		t: (key, params, plural) => {
			const text = lookup(messages, key);
			if (text === null) return key;
			const forms = text.split(PLURAL_SEPARATOR);
			const form = plural === undefined ? forms[0] : choose(forms, plural);
			return interpolate(form, params);
		},
		locale: ref("en-GB"),
	};
}
