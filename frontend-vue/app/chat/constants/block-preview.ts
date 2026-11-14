/** Names the DMS may register its block preview component under. */
export const BLOCK_PREVIEW_COMPONENT_NAMES = [
	"DmsBlockPreview",
	"dms-block-preview",
] as const;

/** Node type `DmsBlockPreview` draws as a sandboxed sketch rather than a block. */
export const SKETCH_NODE_TYPE = "sketch";
/**
 * The block types handed to `DmsBlockPreview` with a sketch: a sketch node
 * reads none, and an allowlist given up front spares the fetch it would
 * otherwise wait on before drawing anything.
 */
export const SKETCH_BLOCK_TYPES: Readonly<Record<string, never>> = {};

export const BLOCK_PREVIEW_MAIN_TAB = "proposed";
export const BLOCK_PREVIEW_VARIANT_TAB_PREFIX = "variant-";

export const JSON_INDENT = 2;

/** Mirror of the sidecar's reference URL rules (sidecar/src/constants/preview.ts). */
export const SAME_ORIGIN_PATH = /^\/(?![/\\])/;
export const REMOTE_URL = /^https?:\/\//i;
/** The DMS's own mockup viewer: an HTML page, drawn in a frame rather than as an image. */
export const MOCKUP_VIEWER_PATH = /^\/mockup(?:[/?#]|$)/;

/** Width the card's live thumbnail is laid out at before it is scaled down. */
export const THUMBNAIL_CANVAS_WIDTH_PX = 560;
export const THUMBNAIL_SCALE = 0.2;
/** Height a sketch is drawn at in the thumbnail, before the scale. */
export const THUMBNAIL_SKETCH_HEIGHT_PX = 360;

/** Most block types the card names before it counts the rest. */
export const CARD_TYPE_LIMIT = 2;

/** The schematic thumbnail drawn when the DMS cannot render the blocks. */
export const PLAN_MAX_ROWS = 3;
export const PLAN_MAX_CELLS = 4;
