import { describe, expect, it } from "vitest";
import { createOnboardingApi } from "../app/onboarding/api";

describe("the onboarding api's token check", () => {
	it.each(["rejected", "unreachable", "malformed", "unsaved"] as const)(
		"keeps the %s answer the backend gave",
		async (reason) => {
			const api = createOnboardingApi({
				get: async () => undefined,
				post: async () => ({ ok: false, reason }),
			});
			expect(await api.checkClaudeToken("sk-ant-oat01-x")).toEqual({
				ok: false,
				reason,
			});
		},
	);

	it("reads an answer of another shape as Anthropic not answering", async () => {
		const api = createOnboardingApi({
			get: async () => undefined,
			post: async () => ({ ok: false, reason: "gone" }),
		});
		expect(await api.checkClaudeToken("sk-ant-oat01-x")).toEqual({
			ok: false,
			reason: "unreachable",
		});
	});
});
