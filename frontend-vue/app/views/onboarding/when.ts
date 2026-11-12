type Step = [Intl.RelativeTimeFormatUnit, number];

const MINUTE: Step = ["minute", 60_000];

/** The units a moment is told in, the largest first. */
const STEPS: readonly Step[] = [
	["year", 31_536_000_000],
	["month", 2_592_000_000],
	["week", 604_800_000],
	["day", 86_400_000],
	["hour", 3_600_000],
	MINUTE,
];

/** How long ago `ms` was, in the user's language: "2h ago", "yesterday". */
export function relativeTime(
	ms: number,
	nowMs: number,
	locale: string,
): string {
	const elapsed = Math.max(0, nowMs - ms);
	const [unit, size] = STEPS.find(([, step]) => elapsed >= step) ?? MINUTE;
	return new Intl.RelativeTimeFormat(locale, {
		numeric: "auto",
		style: "narrow",
	}).format(-Math.floor(elapsed / size), unit);
}
