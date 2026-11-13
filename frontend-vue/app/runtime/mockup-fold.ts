import { computed, type Ref, watch } from "vue";
import type { ChatPanelState } from "./assistant-session";
import { MOCKUP_PATH } from "./constants";

/** Whether `path` shows a mockup: `/mockup` or a page under it. */
export function isMockupPath(path: string): boolean {
	return path === MOCKUP_PATH || path.startsWith(`${MOCKUP_PATH}/`);
}

export interface MockupFoldDeps {
	/** The dashboard's current route path. */
	path: Readonly<Ref<string>>;
	panel: ChatPanelState;
}

export interface MockupFold {
	/** The panel is folded to its bar: a mockup is on screen and the panel is closed. */
	isFolded: Readonly<Ref<boolean>>;
	/** Opens the panel from its bar; it stays open when the mockup is left. */
	unfold: () => void;
	stop: () => void;
}

/**
 * A mockup takes the dashboard's full width, so the docked panel folds to a
 * bar while one is on screen: entering a mockup closes an open panel, and
 * leaving it opens the panel again if the fold closed it and nothing opened it
 * since, so a panel the person closed on the mockup stays closed.
 */
export function createMockupFold(deps: MockupFoldDeps): MockupFold {
	const { path, panel } = deps;
	let reopenOnLeave = false;
	const onMockup = computed(() => isMockupPath(path.value));
	const stopFollowingOpen = watch(
		panel.isOpen,
		(isOpen) => {
			if (isOpen) reopenOnLeave = false;
		},
		{ flush: "sync" },
	);
	const stopFollowingPath = watch(
		onMockup,
		(isOnMockup, wasOnMockup) => {
			if (isOnMockup && wasOnMockup !== true) {
				reopenOnLeave = panel.isOpen.value;
				panel.close();
				return;
			}
			if (!isOnMockup && wasOnMockup === true && reopenOnLeave) {
				reopenOnLeave = false;
				panel.open();
			}
		},
		{ immediate: true },
	);
	return {
		isFolded: computed(() => onMockup.value && !panel.isOpen.value),
		unfold: panel.open,
		stop: () => {
			stopFollowingOpen();
			stopFollowingPath();
		},
	};
}
