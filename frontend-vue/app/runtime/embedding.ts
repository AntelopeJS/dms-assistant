/** The two windows that tell a framed page from a top one. */
interface WindowPlace {
	self: unknown;
	top: unknown;
}

/** Whether the dashboard is drawn inside another page's frame. */
export function isEmbedded(view: WindowPlace): boolean {
	return view.self !== view.top;
}
