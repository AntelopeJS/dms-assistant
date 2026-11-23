import { describe, expect, it } from "vitest";
import { usePermissionQueue } from "../../app/chat/composables/usePermissionQueue";
import { createEventBus } from "./event-bus";

const CONVERSATION_ID = "conv-1";

const PERMISSION_REQUEST = {
	type: "permission_request",
	requestId: "r1",
	callId: "c1",
	toolName: "Edit",
	args: { file_path: "a.ts" },
	summary: "Edit a.ts",
	kind: "edit",
	alwaysAsk: false,
	preview: {
		type: "diff",
		path: "/a.ts",
		relativePath: "a.ts",
		isNewFile: false,
		added: 1,
		removed: 0,
		hunks: [],
	},
	ruleOptions: [{ kind: "file", value: "a.ts" }],
	createdAtMs: 1,
	expiresAtMs: 300_001,
};

describe("approvals answer with the new vocabulary", () => {
	it("allows with a rule, and denies with the user's suggestion", () => {
		const b = createEventBus(CONVERSATION_ID);
		const queue = usePermissionQueue(b.options);
		b.receive(PERMISSION_REQUEST);
		b.receive({ ...PERMISSION_REQUEST, requestId: "r2" });
		queue.respond("r1", {
			decision: "allow_rule",
			rule: { kind: "file", value: "a.ts" },
		});
		queue.respond("r2", {
			decision: "deny",
			feedback: "  Use the Builder instead  ",
		});
		expect(b.sent).toEqual([
			{
				type: "permission_response",
				conversationId: CONVERSATION_ID,
				requestId: "r1",
				decision: "allow_rule",
				rule: { kind: "file", value: "a.ts" },
			},
			{
				type: "permission_response",
				conversationId: CONVERSATION_ID,
				requestId: "r2",
				decision: "deny",
				feedback: "Use the Builder instead",
			},
		]);
		expect(queue.queue.value).toEqual([]);
	});

	it("never offers rules for always-ask", () => {
		const b = createEventBus(CONVERSATION_ID);
		const queue = usePermissionQueue(b.options);
		b.receive({ ...PERMISSION_REQUEST, alwaysAsk: true });
		expect(queue.queue.value[0].ruleOptions).toEqual([]);
	});
});

describe("a request another tab answered, expired or revoked leaves the queue", () => {
	it("drops a request another tab answered, and keeps an expired one as a card", () => {
		const b = createEventBus(CONVERSATION_ID);
		const queue = usePermissionQueue(b.options);
		b.receive(PERMISSION_REQUEST);
		b.receive({ ...PERMISSION_REQUEST, requestId: "r2" });
		b.receive({
			type: "permission_resolved",
			requestId: "r1",
			decision: "allow_once",
		});
		b.receive({
			type: "permission_expired",
			requestId: "r2",
			toolName: "Edit",
			summary: "Edit a.ts",
			expiredAtMs: 9,
		});
		expect(queue.queue.value).toEqual([]);
		expect(queue.expired.value).toEqual([
			{
				requestId: "r2",
				conversationId: CONVERSATION_ID,
				toolName: "Edit",
				summary: "Edit a.ts",
				expiredAtMs: 9,
			},
		]);
	});

	it("denies everything at once, lists rules and revokes them", () => {
		const b = createEventBus(CONVERSATION_ID);
		const queue = usePermissionQueue(b.options);
		b.receive(PERMISSION_REQUEST);
		b.receive({
			type: "rules_state",
			rules: [
				{
					id: "rule-1",
					kind: "command",
					value: "pnpm test",
					label: "Commands starting pnpm test",
					createdAtMs: 1,
				},
			],
		});
		queue.denyAll();
		queue.revokeRule("rule-1");
		expect(b.sent).toEqual([
			{
				type: "permission_response",
				conversationId: CONVERSATION_ID,
				requestId: "r1",
				decision: "deny_all",
			},
			{
				type: "revoke_rule",
				conversationId: CONVERSATION_ID,
				ruleId: "rule-1",
			},
		]);
		expect(queue.rules.value).toEqual([]);
	});
});
