import type { JobKind, Scenario, Step } from "./connection-analysis-world";

const OPEN: Step = { kind: "open" };
const CLOSE: Step = { kind: "close" };
const RESET: Step = { kind: "reset" };
const CLOSE_TAB: Step = { kind: "closeTab" };
const CLOSE_TAB_QUIET: Step = { kind: "closeTab", quiet: true };
const RESET_QUIET: Step = { kind: "reset", quiet: true };

const connect = (database: string, quiet = false): Step => ({
	kind: "connect",
	database,
	quiet,
});

const STARTS_TWICE = "2 analysis jobs started for shop, where one may";

/**
 * Two tabs that both remember `shop`, as a tab duplicated while a connection loads does: the
 * project declares it and each tab's storage holds it.
 */
function duplicated(
	name: string,
	job: JobKind,
	first: Step[],
	second: Step[],
	defect?: string,
): Scenario {
	const scenario: Scenario = {
		name,
		job,
		declared: ["shop"],
		remembered: ["shop", "shop"],
		programs: [first, second],
	};
	if (defect !== undefined) scenario.defect = defect;
	return scenario;
}

/** A tab with nothing remembered, which connects by hand. */
function connecting(
	name: string,
	job: JobKind,
	first: Step[],
	second: Step[] = [],
): Scenario {
	return {
		name,
		job,
		declared: [],
		remembered: [null, null],
		programs: [first, second],
	};
}

/**
 * The tabs, popups and orders of steps the check covers: two tabs of one browser, each with one
 * program of steps, and a job that does or does not ask which schemas to read.
 */
export const SCENARIOS: Scenario[] = [
	duplicated("duplicate, both stay", "asks-schemas", [OPEN], [OPEN]),
	duplicated("duplicate, both stay, no question", "direct", [OPEN], [OPEN]),
	duplicated(
		"duplicate, the first tab closes once every answer arrived",
		"asks-schemas",
		[OPEN, CLOSE_TAB_QUIET],
		[OPEN],
	),
	duplicated(
		"duplicate, the second tab closes once every answer arrived",
		"direct",
		[OPEN],
		[OPEN, CLOSE_TAB_QUIET],
	),
	duplicated(
		"duplicate, the first tab resets once every answer arrived",
		"asks-schemas",
		[OPEN, RESET_QUIET],
		[OPEN],
	),
	duplicated(
		"duplicate, the first tab closes while an answer is in flight",
		"direct",
		[OPEN, CLOSE_TAB],
		[OPEN],
		STARTS_TWICE,
	),
	duplicated(
		"duplicate, the first tab resets while an answer is in flight",
		"direct",
		[OPEN, RESET],
		[OPEN],
		STARTS_TWICE,
	),
	duplicated(
		"duplicate, the first tab connects another database once every answer arrived",
		"asks-schemas",
		[OPEN, connect("orders", true)],
		[OPEN],
	),
	duplicated(
		"duplicate, the first tab connects another database while an answer is in flight",
		"direct",
		[OPEN, connect("orders")],
		[OPEN],
		STARTS_TWICE,
	),
	connecting(
		"connect, close the popup, open it, connect another",
		"asks-schemas",
		[OPEN, connect("shop"), CLOSE, OPEN, connect("orders")],
	),
	connecting("connect, close the popup, open it, reset", "direct", [
		OPEN,
		connect("shop"),
		CLOSE,
		OPEN,
		RESET,
	]),
	connecting("connect, reset, connect another", "asks-schemas", [
		OPEN,
		connect("shop"),
		RESET,
		connect("orders"),
	]),
	connecting("connect twice", "direct", [
		OPEN,
		connect("shop"),
		connect("shop"),
	]),
];
