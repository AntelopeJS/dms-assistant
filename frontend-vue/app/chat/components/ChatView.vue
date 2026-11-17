<script setup lang="ts">
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
} from "vue";
import type { ChatTransport } from "../../runtime/chat-transport";
import type {
	PanelIntent,
	PanelIntents,
	StartConversationIntent,
} from "../../runtime/panel-intents";
import {
	useChangeSetActions,
	type ChatApi,
} from "../composables/useChangeSetActions";
import { useChatChannel } from "../composables/useChatChannel";
import { useChatI18n } from "../composables/useChatI18n";
import { useConversation } from "../composables/useConversation";
import {
	persistConversationId,
	resolveConversationId,
} from "../composables/useConversationId";
import { useConversationList } from "../composables/useConversationList";
import { useConversationMode } from "../composables/useConversationMode";
import { useFollowScroll } from "../composables/useFollowScroll";
import { useMockupIntents } from "../composables/useMockupIntents";
import { usePermissionQueue } from "../composables/usePermissionQueue";
import { useQuestionQueue } from "../composables/useQuestionQueue";
import { useQueueActions } from "../composables/useQueueActions";
import { useRunClock } from "../composables/useRunClock";
import { useSettings } from "../composables/useSettings";
import { EXIT_PLAN_MODE_TOOL_NAME } from "../constants/conversation";
import {
	ACTIVITY_PAGE_PATH,
	CHANGE_SET_QUERY_KEY,
	CHANGES_PAGE_PATH,
	CLIENT_MESSAGE_TYPES,
	SERVER_EVENT_TYPES,
	SETTINGS_PAGE_PATH,
} from "../constants/protocol";
import type { ConversationSummary, CurrentPage } from "../types/conversation";
import type { ExpiredRequest } from "../types/permission";
import type { QuestionReply } from "../types/question";
import type { PendingAttachment } from "../utils/attachments";
import { changingBlock } from "../utils/block-target";
import { formatTokens } from "../utils/format";
import { newUuid } from "../utils/ids";
import {
	type MockupRequest,
	mockupRequestMessage,
} from "../utils/mockup-requests";
import { isRunStalled, runElapsedMs } from "../utils/run-status";
import { describeStatus } from "../utils/status-label";
import { bareToolName } from "../utils/tool-lexicon";
import { latestTodos } from "../utils/todos";
import ApprovalDock from "./ApprovalDock.vue";
import BlockOutline from "./BlockOutline.vue";
import ChatEmpty from "./ChatEmpty.vue";
import Composer from "./Composer.vue";
import ConnectionBanner from "./ConnectionBanner.vue";
import ConversationDrawer from "./ConversationDrawer.vue";
import MessageList from "./MessageList.vue";
import PanelHeader, { type PanelStatusKind } from "./PanelHeader.vue";
import QuestionDock from "./QuestionDock.vue";
import QueueDock from "./QueueDock.vue";
import ProviderNotice from "./ProviderNotice.vue";
import StepsDock from "./StepsDock.vue";
import UndoConflictModal from "./UndoConflictModal.vue";

interface Props {
	/** The chat's side of the tab's stream, which the dashboard owns. */
	transport: ChatTransport;
	intents: PanelIntents;
	page: CurrentPage | null;
	/** The sidecar is coming back up: the transcript stays, under a banner. */
	isReviving: boolean;
	api: ChatApi | null;
}

interface Emits {
	close: [];
	navigate: [path: string];
}

interface FocusableComposer {
	focus: () => void;
	setDraft: (text: string) => void;
}

interface FocusableDock {
	focusRequest: (requestId: string) => void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const { t } = useChatI18n();

const HISTORY_KEY = "j";
const ESCAPE_KEY = "Escape";
const NAVIGATION_TARGETS: Record<string, string> = {
	changes: CHANGES_PAGE_PATH,
	activity: ACTIVITY_PAGE_PATH,
	settings: SETTINGS_PAGE_PATH,
};

const activeId = ref(resolveConversationId());
const channel = useChatChannel({
	transport: props.transport,
	getConversationId: () => activeId.value,
});
const queueOptions = {
	activeId,
	send: channel.send,
	onMessage: channel.onMessage,
};
const permissions = usePermissionQueue(queueOptions);
const questions = useQuestionQueue(queueOptions);
const conversation = useConversation({
	...queueOptions,
	getPagePath: () => props.page?.path,
});
const list = useConversationList({
	send: channel.send,
	onMessage: channel.onMessage,
});
const { settings } = useSettings({ onMessage: channel.onMessage });
const mode = useConversationMode({
	activeId,
	mode: conversation.mode,
	settings,
	send: channel.send,
});
const queueActions = useQueueActions({
	activeId,
	queued: conversation.queued,
	send: channel.send,
});
const changeSetActions = useChangeSetActions({
	activeId,
	changeSets: conversation.changeSets,
	send: channel.send,
	api: props.api,
});

const isDrawerOpen = ref(false);
const nowMs = useRunClock(computed(() => true));
const composerRef = ref<FocusableComposer | null>(null);
const approvalDockRef = ref<FocusableDock | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
const { follow } = useFollowScroll(scrollEl);

const isConnected = channel.isConnected;
const isRunning = conversation.isRunning;
const pendingCount = computed(
	() => permissions.queue.value.length + questions.queue.value.length,
);
const isStalled = computed(
	() =>
		conversation.isTurnInFlight.value &&
		isConnected.value &&
		isRunStalled(conversation.lastEventAtMs.value, nowMs.value),
);
const todos = computed(() => latestTodos(conversation.messages.value));
const mockup = useMockupIntents({
	activeId,
	isRunning,
	newConversation,
	setDraft,
});
const outlinedBlock = computed(() =>
	changingBlock(
		conversation.messages.value,
		isRunning.value,
		props.page?.path ?? null,
	),
);
const agentName = computed(() =>
	t(`dms_assistant.common.agent.${settings.value.provider}`),
);
const providerProblem = computed(
	() => settings.value.providers[settings.value.provider]?.available === false,
);

const title = computed(
	() =>
		list.conversations.value.find((item) => item.id === activeId.value)
			?.title || t("dms_assistant.panel.new_conversation"),
);

const status = computed<PanelStatusKind>(() => {
	if (!isConnected.value)
		return channel.connectionStatus.value === "disconnected"
			? "offline"
			: "connecting";
	if (pendingCount.value > 0) return "waiting";
	return isRunning.value ? "working" : "ready";
});

const statusLabel = computed<string>(() =>
	describeStatus(
		{
			kind: status.value,
			elapsedMs: runElapsedMs(conversation.progress.value, nowMs.value),
			pendingCount: pendingCount.value,
			agentName: agentName.value,
			model: conversation.model.value,
		},
		t,
	),
);

const usageLabel = computed<string>(() => {
	if (!isConnected.value)
		return t("dms_assistant.panel.composer.usage_offline");
	const usage = conversation.usage.value;
	if (usage === null || usage.newTokens + usage.cacheReadTokens === 0) {
		return conversation.messages.value.length === 0
			? t("dms_assistant.panel.composer.usage_new")
			: "";
	}
	const count = formatTokens(usage.newTokens);
	if (usage.cacheReadTokens === 0)
		return t("dms_assistant.panel.composer.usage", { count });
	return t("dms_assistant.panel.composer.usage_cached", {
		count,
		cached: formatTokens(usage.cacheReadTokens),
	});
});

const placeholder = computed<string>(() => {
	if (!isConnected.value)
		return t("dms_assistant.panel.composer.placeholder_offline");
	if (questions.queue.value.length > 0)
		return t("dms_assistant.panel.composer.placeholder_question");
	if (isRunning.value)
		return t("dms_assistant.panel.composer.placeholder_running");
	return t("dms_assistant.panel.composer.placeholder_idle");
});

const isEmpty = computed(
	() => conversation.messages.value.length === 0 && !isRunning.value,
);

/** The server's reason the conversation this tab had open is closed, until the next switch. */
const closedNotice = ref<string | null>(null);

function switchConversation(id: string): void {
	closedNotice.value = null;
	follow();
	isDrawerOpen.value = false;
	if (id === activeId.value) return;
	activeId.value = id;
	persistConversationId(id);
	conversation.reset();
	permissions.clear();
	questions.clear();
	channel.reidentify();
}

function newConversation(): void {
	switchConversation(newUuid());
}

function deleteConversation(item: ConversationSummary): void {
	if (item.isRunning === true)
		channel.send({
			type: CLIENT_MESSAGE_TYPES.INTERRUPT_TURN,
			conversationId: item.id,
		});
	list.remove(item);
	if (item.id === activeId.value) newConversation();
}

function openDrawer(): void {
	list.refresh();
	isDrawerOpen.value = true;
}

function navigate(path: string): void {
	emit("navigate", path);
}

function reviewChangeSet(changeSetId: string): void {
	const query = new URLSearchParams({ [CHANGE_SET_QUERY_KEY]: changeSetId });
	navigate(`${CHANGES_PAGE_PATH}?${query.toString()}`);
}

function sendUserMessage(
	...args: Parameters<typeof conversation.sendUserMessage>
): void {
	follow();
	conversation.sendUserMessage(...args);
}

function submit(
	content: string,
	attachments: PendingAttachment[],
	includePage: boolean,
): void {
	sendUserMessage(content, attachments, {
		...(includePage ? {} : { includePageContext: false }),
		...mockup.takeFocusBlock(),
	});
}

function answerQuestions(requestId: string, replies: QuestionReply[]): void {
	const records = questions.respond(requestId, replies);
	if (records !== null) conversation.recordAnswers(records);
}

function stopTurn(): void {
	conversation.interrupt();
}

function stopAutoFix(): void {
	channel.send({
		type: CLIENT_MESSAGE_TYPES.STOP_AUTOFIX,
		conversationId: activeId.value,
	});
}

function askAgain(summary: string): void {
	sendUserMessage(
		t("dms_assistant.panel.approvals.ask_again_message", { summary }),
	);
}

function askAgainExpired(request: ExpiredRequest): void {
	permissions.dismissExpired(request.requestId);
	askAgain(request.summary);
}

function runPlan(): void {
	mode.setMode("normal");
	const planRequest = permissions.queue.value.find(
		(request) => bareToolName(request.toolName) === EXIT_PLAN_MODE_TOOL_NAME,
	);
	if (planRequest !== undefined) {
		permissions.respond(planRequest.requestId, { decision: "allow_once" });
		return;
	}
	sendUserMessage(t("dms_assistant.panel.plan.go_ahead"));
}

function setDraft(text: string): void {
	composerRef.value?.setDraft(text);
}

/** Runs `run` once the stream is up, if still here. */
function whenConnected(run: () => void): void {
	const conversationId = activeId.value;
	const apply = (): void => {
		if (activeId.value === conversationId) run();
	};
	if (isConnected.value) return apply();
	const stop = watch(isConnected, (connected) => {
		if (!connected) return;
		stop();
		apply();
	});
}

function startConversation(intent: StartConversationIntent): void {
	newConversation();
	const { prompt = "", mode: next } = intent;
	const sends = intent.send === true && prompt !== "";
	if (next !== undefined || sends)
		whenConnected(() => {
			if (next !== undefined) mode.setMode(next);
			if (sends) sendUserMessage(prompt);
		});
	if (sends) return;
	if (prompt) void nextTick(() => setDraft(prompt));
	else void nextTick(() => composerRef.value?.focus());
}

/** Sends a build or a comment run in a new conversation; its steps show in the chat like any turn's. */
function sendMockupRequest(request: MockupRequest): void {
	startConversation({
		kind: "start",
		prompt: mockupRequestMessage(request, t),
		send: true,
	});
}

const INTENT_HANDLERS: Record<
	PanelIntent["kind"],
	(intent: PanelIntent) => void
> = {
	open: (intent) => {
		if (intent.kind === "open") switchConversation(intent.conversationId);
	},
	start: (intent) => {
		if (intent.kind === "start") startConversation(intent);
	},
	prompt: (intent) => {
		if (intent.kind === "prompt") mockup.takePrompt(intent);
	},
	build: (intent) => {
		if (intent.kind === "build") sendMockupRequest(intent);
	},
	"resolve-comments": (intent) => {
		if (intent.kind === "resolve-comments") sendMockupRequest(intent);
	},
	focus: () => void nextTick(() => composerRef.value?.focus()),
	approvals: () => {
		const first = permissions.queue.value[0];
		if (first !== undefined)
			approvalDockRef.value?.focusRequest(first.requestId);
		else openDrawer();
	},
};

watch(
	() => props.intents.pending.value,
	() => {
		const intent = props.intents.take();
		if (intent !== null) INTENT_HANDLERS[intent.kind](intent);
	},
	{ immediate: true },
);

function isHistoryCombo(event: KeyboardEvent): boolean {
	return (
		(event.metaKey || event.ctrlKey) &&
		!event.shiftKey &&
		event.key.toLowerCase() === HISTORY_KEY
	);
}

function onDocumentKeydown(event: KeyboardEvent): void {
	if (!isHistoryCombo(event)) return;
	event.preventDefault();
	if (isDrawerOpen.value) isDrawerOpen.value = false;
	else openDrawer();
}

function onPanelKeydown(event: KeyboardEvent): void {
	if (event.key !== ESCAPE_KEY || event.defaultPrevented) return;
	if (isDrawerOpen.value) {
		isDrawerOpen.value = false;
		return;
	}
	if (isRunning.value) stopTurn();
}

function refreshListAfterTurn(msg: unknown): void {
	if (!isDrawerOpen.value || msg === null || typeof msg !== "object") return;
	if (Reflect.get(msg, "type") === SERVER_EVENT_TYPES.RUN_DONE) list.refresh();
}

channel.onMessage(refreshListAfterTurn);

function leaveClosedConversation(msg: unknown): void {
	if (msg === null || typeof msg !== "object") return;
	if (Reflect.get(msg, "type") !== SERVER_EVENT_TYPES.CONVERSATION_CLOSED)
		return;
	if (Reflect.get(msg, "conversationId") !== activeId.value) return;
	newConversation();
	const message: unknown = Reflect.get(msg, "message");
	closedNotice.value = typeof message === "string" ? message : null;
}

channel.onMessage(leaveClosedConversation);

// The DMS mounts the panel open on a reload, often before the tab's stream
// is up: the list (and the chat's title) is asked for again once it is.
watch(isConnected, (connected) => {
	if (connected) list.refresh();
});

onMounted(() => {
	document.addEventListener("keydown", onDocumentKeydown);
	list.refresh();
});

onBeforeUnmount(() => {
	document.removeEventListener("keydown", onDocumentKeydown);
});
</script>

<template>
	<main class="chat-view" @keydown="onPanelKeydown">
		<PanelHeader
			:title="title"
			:status="status"
			:status-label="statusLabel"
			:rules="permissions.rules.value"
			@history="openDrawer"
			@new-chat="newConversation"
			@close="emit('close')"
			@navigate="(target) => navigate(NAVIGATION_TARGETS[target])"
			@revoke-rule="permissions.revokeRule"
		/>

		<ConnectionBanner
			:status="channel.connectionStatus.value"
			:is-reviving="isReviving"
			@reconnect="channel.reconnect"
		/>

		<section
			ref="scrollEl"
			class="chat-view-body"
			:class="{ 'is-dimmed': !isConnected }"
		>
			<ChatEmpty
				v-if="isEmpty"
				:page="page"
				:scope="mode.current.value.generationMode"
				@suggest="setDraft"
			/>
			<MessageList
				v-else
				:messages="conversation.messages.value"
				:change-sets="conversation.changeSets.value"
				:busy-change-set-ids="changeSetActions.busyIds.value"
				:requests="permissions.queue.value"
				:is-running="isRunning"
				:progress="conversation.progress.value"
				:now-ms="nowMs"
				:is-stalled="isStalled"
				:stalled-for-ms="nowMs - conversation.lastEventAtMs.value"
				@retry="conversation.retry"
				@reconnect="channel.reconnect"
				@stop="stopTurn"
				@focus-request="(id) => approvalDockRef?.focusRequest(id)"
				@undo="changeSetActions.undo"
				@redo="changeSetActions.redo"
				@review="reviewChangeSet"
				@stop-auto-fix="stopAutoFix"
				@ask-again="askAgain"
				@run-plan="runPlan"
				@edit-plan="setDraft(t('dms_assistant.panel.plan.edit_prefix'))"
			/>
			<ProviderNotice
				v-if="providerProblem"
				:agent-name="agentName"
				:reason="settings.providers[settings.provider]?.reason ?? ''"
				:code="settings.providers[settings.provider]?.code"
				@open-settings="navigate(SETTINGS_PAGE_PATH)"
			/>
		</section>

		<div class="cb__dock">
			<ApprovalDock
				ref="approvalDockRef"
				:requests="permissions.queue.value"
				:expired="permissions.expired.value"
				:rules="permissions.rules.value"
				:now-ms="nowMs"
				:timeout-minutes="settings.requestTimeoutMinutes"
				@answer="permissions.respond"
				@deny-all="permissions.denyAll"
				@revoke-rule="permissions.revokeRule"
				@ask-again="askAgainExpired"
				@dismiss-expired="permissions.dismissExpired"
			/>
			<QuestionDock
				v-if="questions.queue.value[0]"
				:request="questions.queue.value[0]"
				:now-ms="nowMs"
				@respond="answerQuestions"
			/>
			<StepsDock
				v-if="todos.length > 0"
				:todos="todos"
				:is-running="isRunning"
			/>
			<QueueDock
				v-if="conversation.queued.value.length > 0"
				:queue="conversation.queued.value"
				@cancel="queueActions.cancel"
				@update="queueActions.update"
				@move="queueActions.move"
				@clear="queueActions.clear"
			/>
			<Composer
				ref="composerRef"
				:is-disabled="!isConnected || providerProblem"
				:is-running="isRunning"
				:mode="mode.current.value"
				:provider="settings.provider"
				:builder-available="settings.builderAvailable"
				:page="page"
				:block="mockup.focusBlock.value"
				:usage-label="usageLabel"
				:placeholder="placeholder"
				@submit="submit"
				@remove-block="mockup.focusBlock.value = null"
				@stop="stopTurn"
				@set-scope="mode.setScope"
				@set-mode="mode.setMode"
				@open-settings="navigate(SETTINGS_PAGE_PATH)"
			/>
		</div>

		<ConversationDrawer
			:open="isDrawerOpen"
			:conversations="list.conversations.value"
			:active-id="activeId"
			:now-ms="nowMs"
			@select="switchConversation"
			@delete="deleteConversation"
			@new="newConversation"
			@close="isDrawerOpen = false"
		/>

		<div v-if="closedNotice" class="cb-toast" role="status">
			<UIcon name="i-ph-chat-circle-slash" class="cb-toast__icon" />
			<span class="cb-toast__text">{{ closedNotice }}</span>
		</div>

		<div v-if="list.pendingDelete.value" class="cb-toast" role="status">
			<UIcon name="i-ph-trash" class="cb-toast__icon" />
			<span class="cb-toast__text">
				{{
					t("dms_assistant.panel.drawer.deleted", {
						title: list.pendingDelete.value.title,
					})
				}}
			</span>
			<UButton
				size="xs"
				color="neutral"
				variant="outline"
				:label="t('dms_assistant.common.undo')"
				@click="list.undoRemove(list.pendingDelete.value.id)"
			/>
		</div>

		<UndoConflictModal
			:pending="changeSetActions.pendingUndo.value"
			@confirm="changeSetActions.confirmUndo"
			@cancel="changeSetActions.cancelUndo"
		/>

		<BlockOutline :path="outlinedBlock" />
	</main>
</template>

<style scoped>
.chat-view-body {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-height: 0;
	overflow-y: auto;
	scrollbar-width: thin;
	transition: opacity 150ms;
}

.chat-view-body.is-dimmed {
	opacity: 0.6;
}

.cb__dock {
	flex: none;
	border-top: 1px solid var(--ui-border);
	background: var(--dms-bg-sidebar);
}

.cb-toast {
	position: absolute;
	right: 12px;
	bottom: 12px;
	left: 12px;
	z-index: 7;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 10px 10px 12px;
	border: 1px solid var(--ui-border-accented);
	border-radius: var(--ai-radius-md);
	background: var(--ui-bg-elevated);
	box-shadow: var(--dms-shadow-pop);
	font-size: 12.5px;
}

.cb-toast__icon {
	width: 15px;
	height: 15px;
	flex: none;
	color: var(--ui-text-muted);
}

.cb-toast__text {
	flex: 1;
	min-width: 0;
}
</style>

<style src="./chat-tokens.css"></style>
