import * as z from "zod/mini";
import {
	MOCKUP_ASSISTANT_RUN_EVENT,
	MOCKUP_ASSISTANT_RUN_QUERY_EVENT,
	type MockupAssistantPrompt,
	type MockupAssistantRun,
	MockupRunSourceSchema,
} from "./assistant-prompt";
import type { ChatTransport } from "./chat-transport";
import { intentOfPrompt, type PanelIntent } from "./panel-intents";
import { isTypedMessage } from "./typed-message";

const STORAGE_KEY = "dms-assistant-mockup-runs";

/** What a run is about: the mockup's folder name and the prompt that started it. */
export type MockupRunTarget = Pick<MockupAssistantRun, "mockup" | "source">;

const StoredRunsSchema = z.array(
	z.object({
		mockup: z.string(),
		source: MockupRunSourceSchema,
		conversationId: z.string(),
	}),
);

interface Run extends MockupRunTarget {
	conversationId: string;
	/**
	 * The stream showed the conversation running, so a list that shows it idle
	 * or gone is its end. A run begun a moment ago may still show idle in a
	 * list sent before the sidecar read its message.
	 */
	isConfirmed: boolean;
}

/** The runs of the assistant on mockups that go on in this tab, and how they are told to the dashboard. */
export interface MockupRuns {
	/** Records that `conversationId` just started the run `target` and tells the dashboard. */
	begin: (target: MockupRunTarget, conversationId: string) => void;
	/** The conversation running `target`, if one is. */
	runningConversation: (target: MockupRunTarget) => string | null;
	/** Tells the dashboard of each run going on. */
	announce: () => void;
	stop: () => void;
}

export interface MockupRunsOptions {
	chat: ChatTransport;
	/** The tab's `sessionStorage`: a reload keeps the runs, and a closed tab drops them. */
	storage: () => Pick<Storage, "getItem" | "setItem">;
	emit: (run: MockupAssistantRun) => void;
}

function keyOf(target: MockupRunTarget): string {
	return `${target.source}\u0000${target.mockup}`;
}

const ENDING_FRAMES = new Set(["run_done", "run_error", "conversation_closed"]);

function conversationOf(msg: object): string | null {
	const id: unknown = Reflect.get(msg, "conversationId");
	return typeof id === "string" ? id : null;
}

/** Whether each conversation of a list frame runs a turn, by id. */
function listedRunning(msg: object): Map<string, boolean> {
	const list: unknown = Reflect.get(msg, "conversations");
	const running = new Map<string, boolean>();
	if (!Array.isArray(list)) return running;
	for (const item of list) {
		if (item === null || typeof item !== "object") continue;
		const id: unknown = Reflect.get(item, "id");
		if (typeof id === "string")
			running.set(id, Reflect.get(item, "isRunning") === true);
	}
	return running;
}

/**
 * Follows the runs of `build` and `resolve-comments` prompts. A run ends with
 * its conversation's `run_done` or `run_error`, with the conversation closing,
 * and, since an interrupted turn may end with neither, when a conversation list shows
 * a run the stream confirmed idle or gone. The runs wait in `storage`, so a
 * reloaded page still knows them: the first list of the new stream tells which
 * are over.
 */
export function createMockupRuns(options: MockupRunsOptions): MockupRuns {
	const runs = new Map<string, Run>();

	function readStored(): Run[] {
		try {
			const text = options.storage().getItem(STORAGE_KEY);
			const parsed = StoredRunsSchema.safeParse(
				text === null ? [] : JSON.parse(text),
			);
			return parsed.success
				? parsed.data.map((run) => ({ ...run, isConfirmed: true }))
				: [];
		} catch {
			return [];
		}
	}

	function keep(): void {
		const stored = [...runs.values()].map(
			({ mockup, source, conversationId }) => ({
				mockup,
				source,
				conversationId,
			}),
		);
		try {
			options.storage().setItem(STORAGE_KEY, JSON.stringify(stored));
		} catch {
			return;
		}
	}

	function end(run: Run): void {
		if (runs.get(keyOf(run)) !== run) return;
		runs.delete(keyOf(run));
		keep();
		options.emit({ mockup: run.mockup, source: run.source, running: false });
	}

	function onFrame(msg: object): void {
		if (!isTypedMessage(msg)) return;
		if (msg.type === "conversation_list") {
			const listed = listedRunning(msg);
			for (const run of [...runs.values()]) {
				if (listed.get(run.conversationId) === true) run.isConfirmed = true;
				else if (run.isConfirmed) end(run);
			}
			return;
		}
		const conversationId = conversationOf(msg);
		if (conversationId === null) return;
		for (const run of [...runs.values()]) {
			if (run.conversationId !== conversationId) continue;
			if (ENDING_FRAMES.has(msg.type)) end(run);
			else if (msg.type === "run_progress") run.isConfirmed = true;
		}
	}

	for (const run of readStored()) runs.set(keyOf(run), run);
	const stopListening = options.chat.onMessage(onFrame);

	return {
		begin: (target, conversationId) => {
			const run: Run = {
				mockup: target.mockup,
				source: target.source,
				conversationId,
				isConfirmed: false,
			};
			runs.set(keyOf(target), run);
			keep();
			options.emit({ mockup: run.mockup, source: run.source, running: true });
		},
		runningConversation: (target) =>
			runs.get(keyOf(target))?.conversationId ?? null,
		announce: () => {
			for (const run of runs.values())
				options.emit({ mockup: run.mockup, source: run.source, running: true });
		},
		stop: stopListening,
	};
}

/**
 * What the panel does for a prompt the mockup editor handed over: open the
 * conversation already running a `build` or `resolve-comments` of the same
 * mockup, otherwise what {@link intentOfPrompt} says.
 */
export function routePrompt(
	prompt: MockupAssistantPrompt,
	runs: Pick<MockupRuns, "runningConversation">,
): PanelIntent {
	if (prompt.source === "build" || prompt.source === "resolve-comments") {
		const conversationId = runs.runningConversation({
			mockup: prompt.prompt,
			source: prompt.source,
		});
		if (conversationId !== null) return { kind: "open", conversationId };
	}
	return intentOfPrompt(prompt);
}

/** Tells the dashboard's window of a run, as {@link MOCKUP_ASSISTANT_RUN_EVENT}. */
export function dispatchMockupRun(run: MockupAssistantRun): void {
	window.dispatchEvent(
		new CustomEvent<MockupAssistantRun>(MOCKUP_ASSISTANT_RUN_EVENT, {
			detail: run,
		}),
	);
}

/**
 * Answers each {@link MOCKUP_ASSISTANT_RUN_QUERY_EVENT} with the runs going on,
 * and tells of them once now: a viewer that mounted before this listener did
 * has already asked.
 */
export function installMockupRunAnswers(runs: MockupRuns): () => void {
	window.addEventListener(MOCKUP_ASSISTANT_RUN_QUERY_EVENT, runs.announce);
	runs.announce();
	return () =>
		window.removeEventListener(MOCKUP_ASSISTANT_RUN_QUERY_EVENT, runs.announce);
}
