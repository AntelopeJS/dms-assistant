import { type InjectionKey, inject, type ShallowRef, watch } from "vue";
import type { OnboardingController } from "./controller";
import { linkedStep, withoutLinkedStep } from "./deep-link";
import type { OnboardingStep, PublicOnboarding } from "./public";

/** The tab's onboarding, `null` until the assistant runs and for good where it does not. */
export type OnboardingRef = Readonly<ShallowRef<OnboardingController | null>>;

export const ONBOARDING_CONTROLLER_KEY: InjectionKey<OnboardingRef> = Symbol(
	"dms-assistant:onboarding-controller",
);

/** The overlay component the plugin registers, the module's `DmsAi` prefix included. */
export const ONBOARDING_COMPONENT_NAME = "DmsAiOnboarding";

/** The card the DMS widget dock unfolds from the assistant's chip. */
export const ONBOARDING_WIDGET_COMPONENT_NAME = "DmsAiOnboardingWidget";

/** The tab's onboarding controller, for a view the overlay draws once it exists. */
export function useOnboarding(): OnboardingController {
	const controller = inject(ONBOARDING_CONTROLLER_KEY, null)?.value;
	if (controller === null || controller === undefined) {
		throw new Error("An onboarding view renders inside DmsAiOnboarding");
	}
	return controller;
}

/** The public onboarding over the tab's controller, which may not exist yet, or ever. */
export function publicOnboarding(controller: OnboardingRef): PublicOnboarding {
	return {
		get isAvailable() {
			return controller.value?.isAvailable.value ?? false;
		},
		open: (step) => controller.value?.open(step),
	};
}

/** What the deep link reads of the dashboard and does to it. */
export interface DeepLinkHost {
	/** The address the browser shows. */
	href: () => string;
	/** The route's `assistant` parameter, reactive. */
	param: () => string | undefined;
	replace: (path: string) => void;
	open: (step: OnboardingStep) => void;
}

/**
 * Opens the popup on the step `?assistant=connect` asks for, on load and after each client
 * navigation, then takes the parameter out of the address, every other parameter and the hash
 * kept.
 */
export function installDeepLink(host: DeepLinkHost): () => void {
	return watch(
		host.param,
		() => {
			const href = host.href();
			const step = linkedStep(href);
			if (step === null) return;
			host.open(step);
			host.replace(withoutLinkedStep(href));
		},
		{ immediate: true },
	);
}
