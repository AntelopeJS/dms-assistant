import type { JsonValue } from "../types/json";
import { toText } from "./json";

const THOUSAND = 1_000;
const MILLION = 1_000_000;
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_WIDTH = 2;

/**
 * Render a tool argument or result for display: text passes through,
 * everything else is pretty-printed JSON.
 */
export function stringifyValue(value: JsonValue | undefined): string {
	if (value === undefined) return "";
	return toText(value) ?? JSON.stringify(value, null, 2);
}

function trimZero(value: number): string {
	return value.toFixed(1).replace(/\.0$/, "");
}

/** A token count as the composer and the drawer show it: 840, 9.6k, 1.2M. */
export function formatTokens(count: number): string {
	if (count < THOUSAND) return String(Math.max(0, Math.round(count)));
	if (count < MILLION) return `${trimZero(count / THOUSAND)}k`;
	return `${trimZero(count / MILLION)}M`;
}

/** A duration as m:ss. */
export function formatClock(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(
		SECONDS_WIDTH,
		"0",
	);
	return `${minutes}:${seconds}`;
}

/** A tool's run time: 0.6s under a minute, m:ss beyond. */
export function formatDuration(ms: number): string {
	if (ms < SECONDS_PER_MINUTE * MS_PER_SECOND)
		return `${trimZero(ms / MS_PER_SECOND)}s`;
	return formatClock(ms);
}

/** A time of day in the interface language, 14:02. */
export function formatTimeOfDay(timestampMs: number, locale: string): string {
	return new Date(timestampMs).toLocaleTimeString(locale, {
		hour: "2-digit",
		minute: "2-digit",
	});
}
