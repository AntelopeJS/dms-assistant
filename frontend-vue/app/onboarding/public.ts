/** A step another module may open the onboarding popup on. */
export type OnboardingStep = "connect-database";

/**
 * The onboarding popup as another module's layer may use it, without depending on dms-assistant:
 * injected under {@link ONBOARDING_KEY} with a `null` default, which is what a project without
 * dms-assistant, or outside development, answers. dms-database hides its "Connect a database"
 * entry on `null`.
 */
export interface PublicOnboarding {
	/** The popup can open in this tab: the assistant runs and its onboarding answered. Reactive. */
	readonly isAvailable: boolean;
	/**
	 * Opens the popup. With `connect-database`, it opens on the connect form of "Start from an
	 * existing database", or first on the AI step when no AI login works yet, then on the form once
	 * one does. Without the builder the connect form does not exist, and the popup opens as its
	 * widget would.
	 */
	open: (step?: OnboardingStep) => void;
}

/**
 * The global key of {@link PublicOnboarding}: `Symbol.for` resolves to the same symbol in every
 * layer, so another module's layer injects it without importing dms-assistant.
 */
export const ONBOARDING_KEY = Symbol.for("dms-assistant:onboarding");

/** The query parameter a link to any dashboard page sets to open the popup on a step. */
export const ONBOARDING_QUERY_PARAM = "assistant";

/** {@link ONBOARDING_QUERY_PARAM}'s value for the connect form: `?assistant=connect`. */
export const CONNECT_DATABASE_LINK = "connect";
