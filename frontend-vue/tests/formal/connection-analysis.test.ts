// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { explore } from "./connection-analysis-world";
import { SCENARIOS } from "./connection-analysis-scenarios";

vi.mock("../../builder/app/runtime/i18n", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	t: (key: string) => key,
}));

const DEPTH = Number(process.env.FORMAL_DEPTH ?? 16);
const TIMEOUT_MS = 600_000;

afterEach(() => {
	Reflect.deleteProperty(window.navigator, "locks");
});

describe("a connection's analysis across tabs", () => {
	for (const scenario of SCENARIOS) {
		it(scenario.name, { timeout: TIMEOUT_MS }, async () => {
			const result = await explore(scenario, DEPTH);
			if (process.env.FORMAL_VERBOSE !== undefined) {
				console.log(
					scenario.name,
					result.paths,
					JSON.stringify(result.failure),
				);
			}
			if (scenario.defect === undefined) {
				expect(result.failure).toBeUndefined();
				return;
			}
			expect(result.failure?.broken).toContain(scenario.defect);
		});
	}
});
