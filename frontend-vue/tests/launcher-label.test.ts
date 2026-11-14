import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import type { Translate } from "../app/chat/composables/useChatI18n";
import {
	type LauncherAction,
	registerLauncher,
} from "../app/runtime/assistant-commands";
import type { LauncherState } from "../app/runtime/launcher-state";

const LAUNCHER_KEY = "dms_assistant.panel.launcher";

/** Like vue-i18n: `t` reads its messages reactively, and gives an empty name while they are missing, as the dashboard does. */
function lateMessages(): {
	t: Translate;
	load: () => void;
} {
	const messages = ref<Record<string, string>>({});
	return {
		t: (key) => messages.value[key] ?? "",
		load: () => {
			messages.value = { [LAUNCHER_KEY]: "Assistant" };
		},
	};
}

describe("the launcher's label", () => {
	it("names the assistant once the locale's messages load after the app mounted", async () => {
		const i18n = lateMessages();
		const registered: LauncherAction[] = [];
		const stop = registerLauncher(
			i18n.t,
			ref<LauncherState>("connected"),
			(action) => registered.push(action),
		);
		i18n.load();
		await nextTick();
		stop();
		expect(registered.at(-1)?.label).toBe("Assistant (Ctrl+Shift+K)");
	});
});
