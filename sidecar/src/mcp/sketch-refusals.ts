import { PREVIEW_SKETCH_FORBIDDEN } from "../constants/preview.js";
import type { PreviewSketchType } from "../protocol/preview.js";

/**
 * What a sketch holds that static HTML and CSS may not, in the order of the
 * checks; empty when it may be shown. The one place the sidecar checks a
 * sketch, so the DMS's own sanitizer can take its place.
 */
export function sketchRefusals(
  sketch: Pick<PreviewSketchType, "html" | "css">,
): string[] {
  const markup = `${sketch.html}\n${sketch.css ?? ""}`;
  return PREVIEW_SKETCH_FORBIDDEN.filter(([pattern]) =>
    pattern.test(markup),
  ).map(([, what]) => what);
}
