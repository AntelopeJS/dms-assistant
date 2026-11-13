import {
	CONNECT_DATABASE_LINK,
	ONBOARDING_QUERY_PARAM,
	type OnboardingStep,
} from "./public";

function isLinkParam(part: string): boolean {
	const name = part.split("=")[0] ?? "";
	try {
		return (
			decodeURIComponent(name.replace(/\+/g, " ")) === ONBOARDING_QUERY_PARAM
		);
	} catch {
		return false;
	}
}

/** The step `?assistant=connect` asks for in a dashboard address, if any. */
export function linkedStep(href: string): OnboardingStep | null {
	const value = new URL(href).searchParams.get(ONBOARDING_QUERY_PARAM);
	return value === CONNECT_DATABASE_LINK ? "connect-database" : null;
}

/**
 * The address without its `assistant` parameter, as a path: every other parameter is kept as it
 * was written, in its place, and the hash too.
 */
export function withoutLinkedStep(href: string): string {
	const url = new URL(href);
	const kept = url.search
		.slice(1)
		.split("&")
		.filter((part) => part !== "" && !isLinkParam(part));
	const search = kept.length > 0 ? `?${kept.join("&")}` : "";
	return `${url.pathname}${search}${url.hash}`;
}
