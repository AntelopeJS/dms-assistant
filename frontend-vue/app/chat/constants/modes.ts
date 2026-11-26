import type { ApprovalMode, ProviderName } from "../types/protocol";

/** The approval modes a provider offers, in the order the composer lists them. */
export function modesFor(provider: ProviderName): readonly ApprovalMode[] {
	switch (provider) {
		case "claude":
			return ["normal", "auto", "acceptEdits", "plan"];
		case "codex":
			return ["normal", "acceptEdits", "plan"];
	}
}

/** The mode as the provider has it: one it lacks reads as Ask first. */
export function modeFor(
	provider: ProviderName,
	mode: ApprovalMode,
): ApprovalMode {
	return modesFor(provider).includes(mode) ? mode : "normal";
}
