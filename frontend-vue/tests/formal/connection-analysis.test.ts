/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { afterEach, describe, expect, it } from "vitest";
import { explore } from "./connection-analysis-world";
import { SCENARIOS } from "./connection-analysis-scenarios";

const DEPTH = Number(process.env.FORMAL_DEPTH ?? 16);
const TIMEOUT_MS = 600_000;

afterEach(() => {
	Reflect.deleteProperty(window.navigator, "locks");
});

describe("a connection's analysis across tabs", () => {
	it.each(SCENARIOS)("$name", { timeout: TIMEOUT_MS }, async (scenario) => {
		const result = await explore(scenario, DEPTH);
		if (process.env.FORMAL_VERBOSE !== undefined) {
			console.log(scenario.name, result.paths, JSON.stringify(result.failure));
		}
		if (scenario.defect === undefined) {
			expect(result.failure).toBeUndefined();
			return;
		}
		expect(result.failure?.broken).toContain(scenario.defect);
	});
});
