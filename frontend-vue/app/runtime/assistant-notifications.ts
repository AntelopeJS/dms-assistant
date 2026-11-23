import { type Ref, watch } from "vue";
import * as z from "zod/mini";
import type { Translate } from "../chat/composables/useChatI18n";
import type { ChatTransport } from "./chat-transport";
import { TOAST_DURATION_MS } from "./constants";
import type { TypedMessage } from "./typed-message";

/** One button of a toast, as Nuxt UI's `useToast().add` takes it. */
interface ToastAction {
	label: string;
	color?: "secondary" | "neutral";
	variant?: "solid" | "outline";
	onClick: () => void;
}

interface ToastInput {
	title: string;
	description?: string;
	icon: string;
	color: "secondary";
	duration: number;
	actions: ToastAction[];
}

const PermissionRequestSchema = z.object({
	conversationId: z.optional(z.string()),
	summary: z.optional(z.string()),
});

/** The part of a change set the toast shows and the Undo button names. */
const NotifiedChangeSetSchema = z.object({
	id: z.string(),
	number: z.number(),
	conversationId: z.string(),
	title: z.string(),
	state: z.string(),
});

export type NotifiedChangeSet = z.infer<typeof NotifiedChangeSetSchema>;

const ChangeSetFrameSchema = z.object({
	changeSet: z.optional(NotifiedChangeSetSchema),
});

const SettingsFrameSchema = z.object({
	settings: z.optional(z.object({ notifyRequests: z.optional(z.boolean()) })),
});

export interface AssistantNotificationsOptions {
	chat: ChatTransport;
	isPanelOpen: Readonly<Ref<boolean>>;
	pendingApprovals: Readonly<Ref<number>>;
	t: Translate;
	toast: (input: ToastInput) => void;
	reviewApprovals: (conversationId?: string) => void;
	undoChangeSet: (changeSet: NotifiedChangeSet) => void;
	reviewChangeSet: (changeSetId: string) => void;
}

const ICON = "i-ph-sparkle";

interface NotifierState {
	options: AssistantNotificationsOptions;
	isEnabled: boolean;
	announcedApprovals: number;
	seenChangeSets: Set<string>;
}

function approvalToast(
	state: NotifierState,
	title: string,
	conversationId?: string,
): void {
	const { t, toast, reviewApprovals, pendingApprovals } = state.options;
	const count = Math.max(pendingApprovals.value, 1);
	state.announcedApprovals = count;
	toast({
		title,
		description: t(
			"dms_assistant.panel.toast.approvals_waiting",
			{ count },
			count,
		),
		icon: ICON,
		color: "secondary",
		duration: TOAST_DURATION_MS,
		actions: [
			{
				label: t("dms_assistant.panel.toast.review"),
				color: "secondary",
				onClick: () => reviewApprovals(conversationId),
			},
			{
				label: t("dms_assistant.panel.toast.later"),
				color: "neutral",
				variant: "outline",
				onClick: () => undefined,
			},
		],
	});
}

function onPermissionRequest(state: NotifierState, msg: TypedMessage): void {
	const frame = PermissionRequestSchema.safeParse(msg);
	if (!frame.success) return;
	if (state.options.isPanelOpen.value || !state.isEnabled) return;
	const { conversationId, summary } = frame.data;
	const title = summary
		? t(state, "dms_assistant.panel.toast.request_title", { summary })
		: t(state, "dms_assistant.panel.toast.request_generic");
	approvalToast(state, title, conversationId);
}

function t(
	state: NotifierState,
	key: string,
	params?: Record<string, string | number>,
): string {
	return state.options.t(key, params);
}

function onChangeSet(state: NotifierState, msg: TypedMessage): void {
	const frame = ChangeSetFrameSchema.safeParse(msg);
	if (!frame.success) return;
	const set = frame.data.changeSet;
	if (set === undefined || state.seenChangeSets.has(set.id)) return;
	state.seenChangeSets.add(set.id);
	if (set.state !== "applied" || state.options.isPanelOpen.value) return;
	const { toast, undoChangeSet, reviewChangeSet } = state.options;
	toast({
		title: t(state, "dms_assistant.panel.toast.applied", {
			number: set.number,
		}),
		description: set.title,
		icon: ICON,
		color: "secondary",
		duration: TOAST_DURATION_MS,
		actions: [
			{
				label: t(state, "dms_assistant.panel.change.undo"),
				color: "neutral",
				variant: "outline",
				onClick: () => undoChangeSet(set),
			},
			{
				label: t(state, "dms_assistant.panel.change.review"),
				color: "secondary",
				onClick: () => reviewChangeSet(set.id),
			},
		],
	});
}

function onSettingsUpdate(state: NotifierState, msg: TypedMessage): void {
	const frame = SettingsFrameSchema.safeParse(msg);
	if (!frame.success) return;
	state.isEnabled = frame.data.settings?.notifyRequests !== false;
}

const FRAME_HANDLERS = new Map<
	string,
	(state: NotifierState, msg: TypedMessage) => void
>([
	["permission_request", onPermissionRequest],
	["change_set", onChangeSet],
	["settings_update", onSettingsUpdate],
]);

/**
 * DMS toasts for what happens while the panel is closed: a request waiting
 * for the user (when the settings allow it) and a change set just applied,
 * with Undo. A request the stream did not carry is caught by the polled count.
 */
export function installAssistantNotifications(
	options: AssistantNotificationsOptions,
): () => void {
	const state: NotifierState = {
		options,
		isEnabled: true,
		announcedApprovals: options.pendingApprovals.value,
		seenChangeSets: new Set(),
	};
	const stopListening = options.chat.onMessage((msg) => {
		FRAME_HANDLERS.get(msg.type)?.(state, msg);
	});
	const stopWatching = watch(options.pendingApprovals, (count) => {
		const isNew = count > state.announcedApprovals;
		if (!isNew) state.announcedApprovals = count;
		if (!isNew || options.isPanelOpen.value || !state.isEnabled) return;
		approvalToast(state, t(state, "dms_assistant.panel.toast.request_generic"));
	});
	return () => {
		stopListening();
		stopWatching();
	};
}
