import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import {
	type DatabaseConnect,
	useDatabaseConnect,
} from "../../app/onboarding/connect-database";
import {
	type ConnectMemory,
	connectMemory,
	CONNECT_MEMORY_KEY,
} from "../../app/onboarding/connect-memory";
import {
	analysisWith,
	LISTED,
	PROJECT,
	READER,
} from "../support/database-connect";

/**
 * What a tab does. A `quiet` step waits until no answer is in flight anywhere, so the tab leaves
 * only after every request sent so far was answered.
 */
export type Step =
	| { kind: "open"; quiet?: boolean }
	| { kind: "close"; quiet?: boolean }
	| { kind: "closeTab"; quiet?: boolean }
	| { kind: "reset"; quiet?: boolean }
	| { kind: "connect"; database: string; quiet?: boolean };

/** Whether the analysis the server starts asks which schemas to read before it finishes. */
export type JobKind = "asks-schemas" | "direct";

export interface Scenario {
	name: string;
	job: JobKind;
	/** The databases the project already declares, which the tabs' remembered connection follows. */
	declared: string[];
	/** The database each tab remembers when it begins, or null for a tab that remembers none. */
	remembered: (string | null)[];
	programs: Step[][];
	/** The rule the current code is known to break in this scenario, when it does. */
	defect?: string;
}

interface Pending {
	id: number;
	tab: Tab;
	label: string;
	deliver: () => void;
}

interface Timer {
	id: number;
	tab: Tab;
	run: () => void;
}

interface Popup {
	wrapper: VueWrapper;
	connect: DatabaseConnect;
}

interface Tab {
	index: number;
	storage: Map<string, string>;
	memory: ConnectMemory;
	program: Step[];
	next: number;
	popup?: Popup;
	closed: boolean;
	expected: string | null;
}

interface Analysis {
	id: string;
	open: unknown[];
}

const SCHEMAS_QUESTION = {
	id: "schemas",
	kind: "schemas",
	question: "which",
	options: [{ value: "public", title: "public (4)" }],
	proposed: null,
};

const OWNER = "owner-1";

function urlOf(database: string): string {
	return `postgres://app:secret@db.example.com/${database}`;
}

function databaseOf(url: string): string {
	return new URL(url).pathname.slice(1);
}

function notFound(): Error {
	return Object.assign(new Error("not found"), { data: { code: "not_found" } });
}

const nextTask = (): Promise<void> => new Promise((done) => setImmediate(done));

/**
 * One run of a scenario: the tabs of one browser over one `@antelopejs/dms`, every step they take
 * and every answer they wait for chosen by the caller, one at a time. The code under test is the
 * real `useDatabaseConnect` with its real `connectMemory`; the server, the Web Locks and the timers
 * are stand-ins that never act by themselves.
 *
 * A request reaches the server the moment it is sent and changes it then; only its answer waits
 * for a choice, and a read answers what the server held when it was sent. A poll timer fires only
 * when no answer is in flight: every answer arrives within the one-second poll period. A Web Lock is decided when it is requested, and only its callback waits. A closed
 * tab stops: its pending answers and timers vanish, its locks are released, and what it already
 * sent stays.
 */
export class World {
	readonly tabs: Tab[] = [];
	readonly starts = new Map<string, number>();
	readonly staleAnswers: string[] = [];
	private readonly declared = new Set<string>();
	private readonly analyses = new Map<string, Analysis>();
	private readonly held = new Map<string, Tab>();
	private pending: Pending[] = [];
	private timers: Timer[] = [];
	private counter = 0;

	constructor(private readonly scenario: Scenario) {
		for (const database of scenario.declared) this.declared.add(database);
		scenario.programs.forEach((program, index) => {
			const storage = new Map<string, string>();
			const memory = connectMemory(
				() => ({
					getItem: (key) => storage.get(key) ?? null,
					setItem: (key, value) => {
						storage.set(key, value);
					},
					removeItem: (key) => {
						storage.delete(key);
					},
				}),
				() => OWNER,
			);
			const remembered = scenario.remembered[index] ?? null;
			if (remembered !== null) {
				memory.write(memory.begin(), {
					engine: "postgres",
					connection: remembered,
					access: READER,
				});
			}
			this.tabs.push({
				index,
				storage,
				memory,
				program,
				next: 0,
				closed: false,
				expected: remembered,
			});
		});
	}

	/** What the next choice can be: each tab's next step, each answer, each timer. */
	choices(): string[] {
		const found: string[] = [];
		for (const tab of this.tabs) {
			if (tab.closed) continue;
			const step = tab.program[tab.next];
			if (step !== undefined && this.allowed(step)) {
				found.push(`tab ${tab.index}: ${step.kind}`);
			}
		}
		for (const pending of this.pending) {
			found.push(`tab ${pending.tab.index}: ${pending.label}`);
		}
		if (this.pending.length === 0) {
			for (const timer of this.timers) {
				found.push(`tab ${timer.tab.index}: poll timer`);
			}
		}
		return found;
	}

	/** Takes the `choice`th of {@link choices}. */
	async take(choice: number): Promise<string> {
		let index = choice;
		for (const tab of this.tabs) {
			if (tab.closed) continue;
			const step = tab.program[tab.next];
			if (step === undefined || !this.allowed(step)) continue;
			if (index === 0) {
				tab.next += 1;
				await this.run(tab, () => this.perform(tab, step));
				return `tab ${tab.index}: ${describe(step)}`;
			}
			index -= 1;
		}
		if (index < this.pending.length) {
			const [pending] = this.pending.splice(index, 1);
			if (pending === undefined) throw new Error("no pending answer");
			await this.run(pending.tab, pending.deliver);
			return `tab ${pending.tab.index}: ${pending.label}`;
		}
		index -= this.pending.length;
		const [timer] = this.timers.splice(index, 1);
		if (timer === undefined) throw new Error("no such choice");
		await this.run(timer.tab, timer.run);
		return `tab ${timer.tab.index}: poll timer`;
	}

	private allowed(step: Step): boolean {
		return step.quiet !== true || this.pending.length === 0;
	}

	/** The rules that must hold after every step; each broken one is a sentence. */
	violations(): string[] {
		const broken: string[] = [];
		for (const [connection, count] of this.starts) {
			if (count > 1) {
				broken.push(
					`${count} analysis jobs started for ${connection}, where one may`,
				);
			}
		}
		for (const stale of this.staleAnswers) {
			broken.push(stale);
		}
		if (this.pending.length === 0) {
			for (const [name, holder] of this.held) {
				if (holder.popup?.connect.phase.value.kind !== "analysing") {
					broken.push(
						`tab ${holder.index} still holds ${name} after it stopped following the connection`,
					);
				}
			}
		}
		for (const tab of this.tabs) {
			const kept = writtenBy(tab.storage);
			if (kept !== undefined && kept !== tab.expected) {
				broken.push(
					`tab ${tab.index} remembers ${kept} after its latest attempt moved to ${tab.expected ?? "nothing"}`,
				);
			}
		}
		return broken;
	}

	/** Unmounts every popup left, as the end of the run does. */
	async end(): Promise<void> {
		for (const tab of this.tabs) {
			await this.run(tab, () => tab.popup?.wrapper.unmount());
			tab.popup = undefined;
		}
	}

	private async run(tab: Tab, body: () => void): Promise<void> {
		const { setTimeout: realSet, clearTimeout: realClear } = globalThis;
		globalThis.setTimeout = ((run: () => void) => {
			this.counter += 1;
			this.timers.push({ id: this.counter, tab, run });
			return this.counter;
		}) as never;
		globalThis.clearTimeout = ((id: number) => {
			this.timers = this.timers.filter((timer) => timer.id !== id);
		}) as never;
		try {
			body();
			await nextTask();
			await nextTask();
		} finally {
			globalThis.setTimeout = realSet;
			globalThis.clearTimeout = realClear;
		}
	}

	private perform(tab: Tab, step: Step): void {
		switch (step.kind) {
			case "open":
				if (tab.popup === undefined) tab.popup = this.mountPopup(tab);
				return;
			case "close":
				tab.popup?.wrapper.unmount();
				tab.popup = undefined;
				return;
			case "closeTab":
				this.closeTab(tab);
				return;
			case "reset":
				tab.popup?.connect.reset();
				tab.expected = null;
				return;
			case "connect":
				if (tab.popup === undefined) return;
				tab.expected = databaseOf(urlOf(step.database));
				void tab.popup.connect.connect("postgres", urlOf(step.database));
				return;
		}
	}

	private closeTab(tab: Tab): void {
		tab.closed = true;
		this.pending = this.pending.filter((pending) => pending.tab !== tab);
		this.timers = this.timers.filter((timer) => timer.tab !== tab);
		for (const [name, holder] of this.held) {
			if (holder === tab) this.held.delete(name);
		}
	}

	private mountPopup(tab: Tab): Popup {
		Object.defineProperty(window.navigator, "locks", {
			value: this.locksOf(tab),
			configurable: true,
		});
		const api = this.apiOf(tab);
		let connect: DatabaseConnect | undefined;
		const wrapper = mount(
			defineComponent({
				setup() {
					connect = useDatabaseConnect(api as never, tab.memory);
					return () => null;
				},
			}),
		);
		if (connect === undefined) throw new Error("the popup did not set up");
		return { wrapper, connect };
	}

	private later<T>(tab: Tab, label: string, value: () => T): Promise<T> {
		return new Promise((resolve) => {
			this.counter += 1;
			this.pending.push({
				id: this.counter,
				tab,
				label,
				deliver: () => resolve(value()),
			});
		});
	}

	private locksOf(tab: Tab) {
		return {
			request: (
				name: string,
				_options: { ifAvailable: boolean },
				callback: (lock: { name: string } | null) => unknown,
			): Promise<unknown> => {
				const taken = this.held.has(name);
				if (!taken) this.held.set(name, tab);
				return this.later(tab, `lock ${name} answered`, () => {
					if (taken) return callback(null);
					const result = Promise.resolve(callback({ name }));
					void result.finally(() => {
						if (this.held.get(name) === tab) this.held.delete(name);
					});
					return result;
				});
			},
		};
	}

	private apiOf(tab: Tab) {
		const connection = (database: string): string => database;
		return {
			checkConnection: () =>
				this.later(tab, "connection check answered", () => READER),
			projectModules: async () => PROJECT,
			configureProject: (
				_steps: unknown,
				_dryRun: boolean,
				variables?: { value: string }[],
			) => {
				const url = variables?.[0]?.value;
				if (url !== undefined) this.declared.add(databaseOf(url));
				return this.later(tab, "project write answered", () => ({ ok: true }));
			},
			setConnectionUrl: (id: string) => {
				this.declared.add(connection(id));
				return this.later(tab, "project write answered", () => ({ ok: true }));
			},
			failure: (error: unknown) => ({
				detail: error instanceof Error ? error.message : String(error),
			}),
			databaseConnection: async (id: string) => {
				if (!this.declared.has(id)) throw notFound();
				return { wiring: { variable: "SHOP_URL" } };
			},
			databaseConnections: async () =>
				[...this.declared].map((id) => ({ ...LISTED, id })),
			latestAnalysis: (id: string) => {
				const sent = this.analyses.get(id);
				return this.later(tab, "analysis read answered", () => {
					return sent === undefined
						? { ok: false }
						: { ok: true, data: { ...analysisWith(sent.open), id: sent.id } };
				});
			},
			analyseDatabase: (id: string, _module: string, schemas?: string[]) => {
				this.analyse(id, schemas);
				return this.later(tab, "analysis request answered", () => ({
					ok: true,
					data: {},
				}));
			},
			reloadDue: async () => ({ due: false }),
		};
	}

	private analyse(id: string, schemas: string[] | undefined): void {
		const existing = this.analyses.get(id);
		if (schemas === undefined) {
			this.starts.set(id, (this.starts.get(id) ?? 0) + 1);
			this.counter += 1;
			this.analyses.set(id, {
				id: `job-${this.counter}`,
				open: this.scenario.job === "asks-schemas" ? [SCHEMAS_QUESTION] : [],
			});
			return;
		}
		if (existing === undefined || existing.open.length === 0) {
			this.staleAnswers.push(
				`the schemas question of ${id} was answered with no question open, which replaces its finished job`,
			);
			return;
		}
		this.counter += 1;
		this.analyses.set(id, { id: `job-${this.counter}`, open: [] });
	}
}

function writtenBy(storage: Map<string, string>): string | undefined {
	const text = storage.get(CONNECT_MEMORY_KEY);
	if (text === undefined) return undefined;
	const stored: unknown = JSON.parse(text);
	if (stored === null || typeof stored !== "object") return undefined;
	const written: unknown = Reflect.get(stored, "written");
	if (written === null || typeof written !== "object") return undefined;
	const connection: unknown = Reflect.get(written, "connection");
	return typeof connection === "string" ? connection : undefined;
}

function describe(step: Step): string {
	return step.kind === "connect" ? `connect ${step.database}` : step.kind;
}

/** The paths a bounded search tried, and the first path that broke a rule. */
export interface Exploration {
	paths: number;
	failure?: { path: string[]; broken: string[] };
}

const DRAIN_LIMIT = 80;

/**
 * Tries every order of the first `depth` choices a scenario offers, then finishes each path by
 * always taking the oldest choice, until nothing is left to choose or {@link DRAIN_LIMIT} steps
 * ran. Each path runs again from the start since the code under test cannot be copied.
 */
export async function explore(
	scenario: Scenario,
	depth: number,
): Promise<Exploration> {
	const result: Exploration = { paths: 0 };
	const stack: number[][] = [[]];
	for (let prefix = stack.pop(); prefix !== undefined; prefix = stack.pop()) {
		const world = new World(scenario);
		const path: string[] = [];
		let broken: string[] = [];
		for (const choice of prefix) {
			path.push(await world.take(choice));
			broken = world.violations();
			if (broken.length > 0) break;
		}
		let open = world.choices().length;
		if (broken.length === 0 && prefix.length >= depth) {
			for (let step = 0; step < DRAIN_LIMIT && open > 0; step += 1) {
				path.push(await world.take(0));
				broken = world.violations();
				open = broken.length > 0 ? 0 : world.choices().length;
				if (broken.length > 0) break;
			}
			open = 0;
		}
		await world.end();
		if (broken.length > 0) {
			result.paths += 1;
			result.failure = { path, broken };
			return result;
		}
		if (open === 0) {
			result.paths += 1;
			continue;
		}
		for (let choice = open - 1; choice >= 0; choice -= 1) {
			stack.push([...prefix, choice]);
		}
	}
	return result;
}
