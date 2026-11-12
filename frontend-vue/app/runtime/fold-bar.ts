import { type App, h, type Ref, render } from "vue";
import FoldBar from "../chat/components/FoldBar.vue";
import type { LauncherState } from "./launcher-state";
import type { MockupFold } from "./mockup-fold";

/**
 * Draws the folded panel's bar on the page, outside the side panel the DMS
 * owns, with the app's context so it reaches its components and i18n.
 */
export function mountFoldBar(
	app: App,
	fold: MockupFold,
	state: Readonly<Ref<LauncherState>>,
): () => void {
	const host = document.createElement("div");
	document.body.append(host);
	const bar = h(FoldBar, {
		isFolded: fold.isFolded,
		state,
		onUnfold: fold.unfold,
	});
	bar.appContext = app._context;
	render(bar, host);
	return () => {
		render(null, host);
		host.remove();
	};
}
