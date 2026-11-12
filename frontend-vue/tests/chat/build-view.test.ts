import { describe, expect, it } from "vitest";
import type {
	ConversationMessage,
	ToolCallMessage,
} from "../../app/chat/types/conversation";
import { buildView } from "../../app/chat/utils/build-view";

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
		const call = tool("c1", "mcp__dms-ai__builder_page_structure", {
			page: "/rentals",
		});
		const withTodos = buildView("bikes", [request, call, todos], true);
		expect(
			withTodos.steps.map((step) =>
				step.kind === "todo" ? [step.text, step.state] : null,
			),
		).toEqual([
			["Create the pages", "done"],
			["Comparing with the mockup", "running"],
		]);
		const withCalls = buildView("bikes", [request, call], true);
		expect(withCalls.steps.map((step) => step.kind)).toEqual(["tool"]);
	});

	it("only counts the turn since the build request (fails when an earlier turn's calls show)", () => {
		const earlier = tool("c0", "Read", { file_path: "/a.ts" });
		const view = buildView("bikes", [earlier, request], true);
		expect(view.steps).toEqual([]);
		expect(view.isDone).toBe(false);
	});

	it("opens the last page the build worked on, once done (fails when a non-Builder path or the block part is kept)", () => {
		const view = buildView(
			"bikes",
			[
				request,
				tool("c1", "mcp__dms-ai__builder_add_block", { page: "/rentals#grid" }),
				tool("c2", "mcp__dms-ai__navigate", { page: "/elsewhere" }),
			],
			false,
		);
		expect(view.pagePath).toBe("/rentals");
		expect(view.isDone).toBe(true);
	});

	it("shows a failed call as failed, and a pending call as done once the turn ended (fails when a stopped call spins)", () => {
		const view = buildView(
			"bikes",
			[
				request,
				tool("c1", "Bash", { command: "tsc" }, "error"),
				tool("c2", "Read", { file_path: "/a.ts" }, "pending"),
			],
			false,
		);
		expect(view.steps.map((step) => step.state)).toEqual(["failed", "done"]);
	});
});
