import { describe, expect, it } from "vitest";
import type {
	ConversationMessage,
	ToolCallMessage,
} from "../../app/chat/types/conversation";
import { buildView } from "../../app/chat/utils/build-view";

const BIKES = { mockup: "bikes" };

function report(ok: boolean, failures: string[]) {
	return { ok, pages: [{ page: "/rentals", ok, failures }] };
}

function verify(ok: boolean, failures: string[]): ToolCallMessage {
	return {
		...tool(`v-${String(ok)}`, "mcp__dms__page_verify", { page: "/rentals" }),
		result: [{ type: "text", text: JSON.stringify(report(ok, failures)) }],
	};
}

const request: ConversationMessage = {
	id: "u1",
	role: "user",
	content: "Build bikes",
	timestampMs: 0,
};

function tool(
	id: string,
	toolName: string,
	args: unknown,
	status: ToolCallMessage["status"] = "success",
): ToolCallMessage {
	return {
		id,
		role: "tool",
		callId: id,
		toolName,
		args,
		status,
		timestampMs: 0,
	};
}

describe("the build dialog's view of a build turn", () => {
	it("lists the build's todos when it keeps some, its tool calls otherwise (fails when the calls hide the plan)", () => {
		const todos = tool("t1", "TodoWrite", {
			todos: [
				{
					content: "Create the pages",
					activeForm: "Creating the pages",
					status: "completed",
				},
				{
					content: "Compare",
					activeForm: "Comparing with the mockup",
					status: "in_progress",
				},
			],
		});
		const call = tool("c1", "mcp__dms-assistant__builder_page_structure", {
			page: "/rentals",
		});
		const withTodos = buildView(BIKES, [request, call, todos], true);
		expect(
			withTodos.steps.map((step) =>
				step.kind === "todo" ? [step.text, step.state] : null,
			),
		).toEqual([
			["Create the pages", "done"],
			["Comparing with the mockup", "running"],
		]);
		const withCalls = buildView(BIKES, [request, call], true);
		expect(withCalls.steps.map((step) => step.kind)).toEqual(["tool"]);
	});

	it("only counts the turn since the build request (fails when an earlier turn's calls show)", () => {
		const earlier = tool("c0", "Read", { file_path: "/a.ts" });
		const view = buildView(BIKES, [earlier, request], true);
		expect(view.steps).toEqual([]);
		expect(view.outcome).toBe("running");
	});

	it("opens the last page the build worked on, once done (fails when a non-Builder path or the block part is kept)", () => {
		const view = buildView(
			BIKES,
			[
				request,
				tool("c1", "mcp__dms-assistant__builder_add_block", {
					page: "/rentals#grid",
				}),
				tool("c2", "mcp__dms-assistant__navigate", { page: "/elsewhere" }),
			],
			false,
		);
		expect(view.pagePath).toBe("/rentals");
		expect(view.outcome).toBe("built");
	});

	it("shows a failed call as failed, and a call left open by the end of the turn as stopped (fails when a stopped call reads as done)", () => {
		const view = buildView(
			BIKES,
			[
				request,
				tool("c1", "Bash", { command: "tsc" }, "error"),
				tool("c2", "Read", { file_path: "/a.ts" }, "pending"),
			],
			false,
		);
		expect(view.steps.map((step) => step.state)).toEqual(["failed", "stopped"]);
		expect(view.outcome).toBe("stopped");
	});

	it("reads a build that ended on an error as failed, not built (fails when any ended turn reads as built)", () => {
		const error: ConversationMessage = {
			id: "e1",
			role: "error",
			content: "The agent stopped: rate limited",
			isRetryable: true,
			timestampMs: 0,
		};
		expect(buildView(BIKES, [request, error], false).outcome).toBe("failed");
	});

	it("reads the outcome from the last page check, not the last call (fails when a failed check after a clean call reads as built)", () => {
		const failing = verify(false, ["the table drew no rows"]);
		const failed = buildView(
			BIKES,
			[request, failing, tool("c9", "mcp__dms-assistant__builder_refresh", {})],
			false,
		);
		expect(failed.outcome).toBe("failed");
		expect(failed.failures).toEqual(["/rentals: the table drew no rows"]);
		const fixed = buildView(
			BIKES,
			[
				request,
				failing,
				tool("c2", "Bash", { command: "tsc" }, "error"),
				verify(true, []),
			],
			false,
		);
		expect(fixed.outcome).toBe("built");
		expect(fixed.failures).toEqual([]);
	});

	it("reads a report stored as text the way a reloaded chat keeps it (fails when only live content blocks are read)", () => {
		const stored = {
			...verify(false, ["blank page"]),
			result: JSON.stringify(report(false, ["blank page"])),
		};
		expect(buildView(BIKES, [request, stored], false).failures).toEqual([
			"/rentals: blank page",
		]);
	});

	it("opens the page built into when the build has one (fails when the dialog opens the last page touched instead)", () => {
		const view = buildView(
			{ mockup: "bikes", pageRef: "/shop/board" },
			[
				request,
				tool("c1", "mcp__dms-assistant__builder_add_block", {
					page: "/rentals#grid",
				}),
			],
			false,
		);
		expect(view.pagePath).toBe("/shop/board");
	});
});
