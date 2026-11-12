// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type {
	ConversationMessage,
	ToolCallMessage,
} from "../../app/chat/types/conversation";
import { blockOutlineRect } from "../../app/chat/utils/block-outline";
import {
	blockTargetOf,
	changingBlock,
	layoutPathOf,
} from "../../app/chat/utils/block-target";

function tool(toolName: string, args: unknown): ToolCallMessage {
	return {
		id: `${toolName}-${JSON.stringify(args)}`,
		role: "tool",
		callId: "call",
		toolName: `mcp__dms-ai__${toolName}`,
		args,
		status: "pending",
		timestampMs: 0,
	};
}

const user: ConversationMessage = {
	id: "user",
	role: "user",
	content: "Add a chart",
	timestampMs: 0,
};

describe("the block a Builder call changes", () => {
	it("reads the Builder path as the page's layout path (fails when the page or the slashes are kept)", () => {
		expect(layoutPathOf("/dashboard#grid/row/kpi")).toBe("grid.row.kpi");
		expect(layoutPathOf("/dashboard#chart")).toBe("chart");
		expect(layoutPathOf("/dashboard#")).toBeNull();
		expect(layoutPathOf("chart")).toBeNull();
	});

	it("takes the changed block of a configure and the parent of an add (fails when an add outlines nothing or a read outlines)", () => {
		expect(
			blockTargetOf(
				tool("builder_configure_block", { path: "/d#grid/kpi", patch: {} }),
			),
		).toBe("grid.kpi");
		expect(
			blockTargetOf(
				tool("builder_add_block", { page: "/d", parent: "/d#grid" }),
			),
		).toBe("grid");
		expect(blockTargetOf(tool("builder_add_block", { page: "/d" }))).toBeNull();
		expect(
			blockTargetOf(tool("builder_page_structure", { page: "/d" })),
		).toBeNull();
	});
});

describe("the block a running turn is changing", () => {
	it("is the latest target of the current turn while it runs (fails when an earlier call or an earlier turn wins)", () => {
		const earlier = tool("builder_remove_block", { path: "/d#old" });
		const first = tool("builder_configure_block", { path: "/d#a" });
		const read = tool("builder_page_structure", { page: "/d" });
		const latest = tool("builder_move_block", { path: "/d#grid/b" });
		expect(changingBlock([earlier, user, first, latest, read], true)).toBe(
			"grid.b",
		);
		expect(changingBlock([earlier, user, read], true)).toBeNull();
	});

	it("is none once the turn ends (fails when the outline stays after the change)", () => {
		const call = tool("builder_configure_block", { path: "/d#a" });
		expect(changingBlock([user, call], false)).toBeNull();
	});
});

function block(path: string, box: { top: number; left: number }): HTMLElement {
	const element = document.createElement("div");
	element.setAttribute("data-dms-block", path);
	element.getBoundingClientRect = () =>
		DOMRect.fromRect({ x: box.left, y: box.top, width: 100, height: 50 });
	return element;
}

describe("the outline on the page", () => {
	it("surrounds the block and the blocks drawn under it, not its siblings (fails on a prefix match such as grid2)", () => {
		document.body.replaceChildren(
			block("grid.kpi", { top: 10, left: 10 }),
			block("grid.chart", { top: 100, left: 200 }),
			block("grid2", { top: 500, left: 500 }),
		);
		expect(blockOutlineRect(document, "grid")).toEqual({
			top: 10,
			left: 10,
			width: 290,
			height: 140,
		});
	});

	it("draws nothing while a modal dialog covers the page (fails when the outline paints over the dialog)", () => {
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		document.body.replaceChildren(block("chart", { top: 0, left: 0 }), dialog);
		expect(blockOutlineRect(document, "chart")).toBeNull();
	});

	it("ignores a copy of the block drawn in the chat's preview (fails when the preview is outlined)", () => {
		const preview = document.createElement("div");
		preview.setAttribute("data-dms-block-preview", "");
		preview.append(block("chart", { top: 0, left: 0 }));
		document.body.replaceChildren(preview);
		expect(blockOutlineRect(document, "chart")).toBeNull();
	});
});
