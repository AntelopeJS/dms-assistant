/** The attribute a page draws on a block's root element: its layout path. */
const BLOCK_PATH_ATTRIBUTE = "data-dms-block";
const LAYOUT_SEPARATOR = ".";
/** Blocks drawn inside these are copies (a preview in the chat), not the page's. */
const OUTSIDE_PAGE_SELECTOR = "[data-dms-block-preview], .chat-view";

export interface OutlineRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

function isUnder(element: Element, path: string): boolean {
	const own = element.getAttribute(BLOCK_PATH_ATTRIBUTE);
	if (own === null) return false;
	return own === path || own.startsWith(`${path}${LAYOUT_SEPARATOR}`);
}

/**
 * The box around the block at `path` on the page: its own element and every
 * block drawn under it, since a container draws no attribute of its own.
 * `null` when the page shows none of them.
 */
export function blockOutlineRect(
	root: ParentNode,
	path: string,
): OutlineRect | null {
	const boxes = [...root.querySelectorAll(`[${BLOCK_PATH_ATTRIBUTE}]`)]
		.filter(
			(element) =>
				isUnder(element, path) &&
				element.closest(OUTSIDE_PAGE_SELECTOR) === null,
		)
		.map((element) => element.getBoundingClientRect())
		.filter((box) => box.width > 0 && box.height > 0);
	if (boxes.length === 0) return null;
	const top = Math.min(...boxes.map((box) => box.top));
	const left = Math.min(...boxes.map((box) => box.left));
	const bottom = Math.max(...boxes.map((box) => box.bottom));
	const right = Math.max(...boxes.map((box) => box.right));
	return { top, left, width: right - left, height: bottom - top };
}
