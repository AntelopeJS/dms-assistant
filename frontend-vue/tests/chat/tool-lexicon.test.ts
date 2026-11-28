import { describe, expect, it } from "vitest";
import {
	bareToolName,
	describeTool,
	namedArguments,
	readableToolName,
	TOOL_VERB_KEYS,
	toolVerb,
} from "../../app/chat/utils/tool-lexicon";
import {
	findWaitingRequest,
	toolRowState,
} from "../../app/chat/utils/tool-state";
import type { ToolCallMessage } from "../../app/chat/types/conversation";
import type { PermissionRequestData } from "../../app/chat/types/permission";
import { permissionCardText } from "../../app/chat/utils/permission-view";

const echo = (key: string): string => key;

function permissionRequest(
	overrides: Partial<PermissionRequestData> = {},
): PermissionRequestData {
	return {
		requestId: "r",
		conversationId: "c",
		toolName: "Edit",
		args: {},
		summary: "Use tool: Edit",
		kind: "edit",
		alwaysAsk: false,
		preview: { type: "generic", args: {} },
		ruleOptions: [],
		createdAtMs: 0,
		expiresAtMs: 0,
		...overrides,
	};
}

function tool(overrides: Partial<ToolCallMessage> = {}): ToolCallMessage {
	return {
		id: "m1",
		role: "tool",
		callId: "call-1",
		toolName: "Edit",
		args: { file_path: "/repo/crm/customer.form.ts" },
		status: "pending",
		timestampMs: 0,
		...overrides,
	};
}

describe("the tool lexicon names a call by what it does", () => {
	it("reads a file edit as a verb and the file's name", () => {
		const description = describeTool("Edit", {
			file_path: "/repo/crm/customer.form.ts",
		});
		expect(toolVerb(description, echo)).toBe("dms_assistant.tools.edit_file");
		expect(description.target).toBe("customer.form.ts");
	});

	it("names a Builder block by its name and type, through the MCP prefix", () => {
		const description = describeTool("mcp__dms-assistant__builder_add_block", {
			page: "sales/overview",
			name: "Top customers",
			type: "TopListCard",
		});
		expect(description.verbKey).toBe("add_block");
		expect(description.target).toBe("Top customers · TopListCard");
	});

	it("shows a command, a search and a URL the way a person reads them", () => {
		expect(describeTool("Bash", { command: "pnpm add jsvat" }).target).toBe(
			"pnpm add jsvat",
		);
		expect(describeTool("Grep", { pattern: "vatNumber" }).target).toBe(
			"“vatNumber”",
		);
		expect(
			describeTool("WebFetch", { url: "https://api.vies.eu/check?x=1" }).target,
		).toBe("api.vies.eu/check");
	});

	it("covers every Builder tool and the assistant's own", () => {
		const builder = [
			"builder_catalog",
			"builder_delete_page",
			"builder_move_block",
			"builder_delete_resource",
			"builder_remove_field",
			"builder_remove_query",
			"builder_query_templates",
			"builder_preview_query",
		];
		for (const name of [
			...builder,
			"ask_user",
			"create_artifact",
			"typecheck",
			"navigate_to_page",
		])
			expect(
				describeTool(`mcp__dms-assistant__${name}`, {}).verbKey,
			).not.toBeNull();
	});

	it("names the DMS page check, whatever server serves it (fails when page_verify shows its raw name)", () => {
		const description = describeTool("mcp__dms__page_verify", {
			page: "/rentals",
		});
		expect(toolVerb(description, (key) => key)).toBe(
			"dms_assistant.tools.verify_page",
		);
		expect(description.target).toBe("/rentals");
	});

	it("falls back to a readable form of a tool it does not know", () => {
		const description = describeTool("mcp__other__FetchInvoiceTotals", {
			name: "Q3",
		});
		expect(description.verbKey).toBeNull();
		expect(toolVerb(description, echo)).toBe("Fetch invoice totals");
		expect(description.target).toBe("Q3");
		expect(readableToolName("some_tool")).toBe("Some tool");
		expect(bareToolName("mcp__dms-assistant__ask_user")).toBe("ask_user");
	});

	it("lists named arguments, values on one line", () => {
		expect(namedArguments({ page: "sales", position: { row: 2 } })).toEqual([
			{ name: "page", value: "sales" },
			{ name: "position", value: '{"row":2}' },
		]);
	});

	it("has no verb twice", () => {
		expect(new Set(TOOL_VERB_KEYS).size).toBe(TOOL_VERB_KEYS.length);
	});
});

describe("a tool row is in one of eight states", () => {
	it("takes the sidecar's outcome when there is one", () => {
		for (const outcome of [
			"done",
			"failed",
			"denied",
			"blocked",
			"stopped",
			"held",
		] as const)
			expect(toolRowState(tool({ outcome, status: "error" }), true, null)).toBe(
				outcome,
			);
	});

	it("tells running, waiting and stopped apart for an open call", () => {
		const request = permissionRequest({
			requestId: "r1",
			callId: "call-1",
			toolName: "Edit",
		});
		const waiting = findWaitingRequest(tool(), [request]);
		expect(waiting).toEqual({ index: 0, total: 1, requestId: "r1" });
		expect(toolRowState(tool(), true, waiting)).toBe("waiting");
		expect(toolRowState(tool(), true, null)).toBe("running");
		expect(toolRowState(tool(), false, null)).toBe("stopped");
	});

	it("matches a request without call id by its tool", () => {
		const request = permissionRequest({ requestId: "r2", toolName: "Edit" });
		expect(findWaitingRequest(tool(), [request])?.requestId).toBe("r2");
		expect(
			findWaitingRequest(tool({ toolName: "Bash" }), [request]),
		).toBeNull();
	});
});

describe("permission cards are titled from the preview, never the raw tool", () => {
	const t = (key: string, params?: Record<string, string | number>): string =>
		`${key}${params ? JSON.stringify(params) : ""}`;
	const base = {
		requestId: "r",
		conversationId: "c",
		args: {},
		summary: "Use tool: builder_delete_page",
		alwaysAsk: true,
		ruleOptions: [],
		createdAtMs: 0,
		expiresAtMs: 0,
	};

	it("names a Builder deletion by what it deletes", () => {
		const text = permissionCardText(
			{
				...base,
				toolName: "mcp__dms-assistant__builder_delete_page",
				kind: "destructive",
				preview: {
					type: "destructive",
					operation: "builder_delete_page",
					target: "/home",
					consequence: "removes_code",
				},
			},
			t,
		);
		expect(text.title).toBe(
			'dms_assistant.panel.approvals.destructive.delete_page{"target":"/home"}',
		);
		expect(text.sub).toBe(
			"dms_assistant.panel.approvals.consequence_removes_code",
		);
	});

	it("titles a generic request with the lexicon, not the summary", () => {
		const text = permissionCardText(
			{
				...base,
				toolName: "mcp__dms-assistant__builder_remove_block",
				args: { path: "home/contactForm" },
				kind: "builder",
				preview: { type: "generic", args: {} },
			},
			t,
		);
		expect(text.title).toBe(
			"dms_assistant.tools.remove_block home/contactForm",
		);
		expect(text.sub).toBe("");
	});
});
