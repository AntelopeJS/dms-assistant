import { PREVIEW_SKETCH_FORBIDDEN } from "../constants/preview.js";
import type { PreviewSketchType } from "../protocol/preview.js";

/**
 * What a sketch holds that static HTML and CSS may not, in the order of the
 * checks; empty when it may be shown. Same contract as `sketchRefusals` of
 * `@antelopejs/dms/sketch`, which replaces this check once the stack moves
 * to a dms release that publishes it.
 */
export function sketchRefusals(
  sketch: Pick<PreviewSketchType, "html" | "css">,
): string[] {
  const markup = `${sketch.html}\n${sketch.css ?? ""}`;
  return PREVIEW_SKETCH_FORBIDDEN.filter(([pattern]) =>
    pattern.test(markup),
  ).map(([, what]) => what);
}
