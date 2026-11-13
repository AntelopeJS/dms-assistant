import { describe, expect, it } from "vitest";
import { isEmbedded } from "../app/runtime/embedding";

describe("a dashboard drawn in a frame", () => {
	it("is embedded when its window is not the top one (fails when a framed mockup starts its own assistant)", () => {
		const top = { name: "top" };
		expect(isEmbedded({ self: { name: "frame" }, top })).toBe(true);
		expect(isEmbedded({ self: top, top })).toBe(false);
	});
});
