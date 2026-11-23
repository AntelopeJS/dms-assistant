<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import ChatView from "../chat/components/ChatView.vue";
import { useChatI18n } from "../chat/composables/useChatI18n";
import { SETTINGS_PAGE_PATH } from "../chat/constants/protocol";
import { ASSISTANT_SESSION_KEY } from "../runtime/assistant-session";
import {
	SIDECAR_STATUS_CONNECTING,
	SIDECAR_STATUS_REVIVING,
	SIDECAR_STATUS_UNAVAILABLE,
} from "../runtime/constants";

/**
 * The DMS docks this component in its side panel and mounts it while the
 * panel is open; the session arrives once the sidecar answered its first
 * probe, and the panel shows the first connection until then.
 */
const sessionRef = inject(ASSISTANT_SESSION_KEY, null);
const session = computed(() => sessionRef?.value ?? null);
const { t } = useChatI18n();
const isRestarting = ref(false);
/**
 * Drawn once mounted, inside a host element rendered on the server and the
 * client alike, so hydration always finds the same node.
 */
const isMounted = ref(false);

const status = computed(
	() => session.value?.status.value ?? SIDECAR_STATUS_CONNECTING,
);
const isUnavailable = computed(
	() => status.value === SIDECAR_STATUS_UNAVAILABLE,
);
const isFirstConnect = computed(
	() => status.value === SIDECAR_STATUS_CONNECTING,
);
const lastError = computed(() => session.value?.lastError.value ?? null);

function close(): void {
	session.value?.panel.close();
}

function navigate(path: string): void {
	session.value?.navigate(path);
}

async function restart(): Promise<void> {
	if (session.value === null || isRestarting.value) return;
	isRestarting.value = true;
	try {
		await session.value.restart();
	} finally {
		isRestarting.value = false;
	}
}

onMounted(() => {
	isMounted.value = true;
});
</script>

<template>
	<div class="dms-assistant-panel">
		<template v-if="isMounted">
			<ChatView
				v-if="session"
				class="dms-assistant-panel-chat"
				:transport="session.chat"
				:intents="session.intents"
				:runs="session.runs"
				:page="session.currentPage.value"
				:is-reviving="status === SIDECAR_STATUS_REVIVING"
				:api="session.api"
				@close="close"
				@navigate="navigate"
			/>
			<div
				v-if="isUnavailable || isFirstConnect"
				class="dms-assistant-panel-status"
				role="status"
			>
				<UButton
					v-if="session"
					size="sm"
					color="neutral"
					variant="ghost"
					square
					icon="i-ph-x"
					class="dms-assistant-panel-close"
					:aria-label="t('dms_assistant.panel.header.close')"
					@click="close"
				/>
				<template v-if="isUnavailable">
					<DmsIconWell icon="i-ph-plugs" tone="error" size="lg" />
					<b class="dms-assistant-panel-status-title">
						{{ t("dms_assistant.panel.unavailable.title") }}
					</b>
					<span class="dms-assistant-panel-status-text">
						{{
							lastError
								? t("dms_assistant.panel.unavailable.text_error")
								: t("dms_assistant.panel.unavailable.text")
						}}
					</span>
					<code v-if="lastError" class="dms-assistant-panel-error">
						{{ lastError }}
					</code>
					<div class="dms-assistant-panel-actions">
						<UButton
							size="sm"
							color="secondary"
							icon="i-ph-arrows-clockwise"
							:loading="isRestarting"
							:label="t('dms_assistant.panel.unavailable.restart')"
							@click="restart"
						/>
						<UButton
							size="sm"
							color="neutral"
							variant="outline"
							icon="i-ph-gear-six"
							:label="t('dms_assistant.panel.header.settings')"
							@click="navigate(SETTINGS_PAGE_PATH)"
						/>
					</div>
					<span class="dms-assistant-panel-note">
						{{ t("dms_assistant.panel.unavailable.kept") }}
					</span>
				</template>
				<template v-else>
					<span class="dms-assistant-panel-spinner" />
					<b class="dms-assistant-panel-status-title">
						{{ t("dms_assistant.panel.connection.first_connect") }}
					</b>
				</template>
			</div>
		</template>
	</div>
</template>

<style scoped>
.dms-assistant-panel {
	position: relative;
	display: flex;
	min-width: 0;
	overflow: hidden;
	color: var(--ui-text);
}

.dms-assistant-panel-chat {
	flex: 1 1 auto;
	min-width: 0;
}

.dms-assistant-panel-status {
	position: absolute;
	inset: 0;
	z-index: 2;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 14px;
	padding: 24px;
	text-align: center;
	font-size: 13px;
	font-weight: 500;
	line-height: 1.5;
	background: var(--dms-bg-sidebar, var(--ui-bg));
}

.dms-assistant-panel-status-title {
	font-size: 15px;
	font-weight: 600;
}

.dms-assistant-panel-status-text {
	color: var(--ui-text-muted);
}

/* Sits where the panel header's close button does: centred in a header
   as tall as the DMS navbar (28px is the small square button height). */
.dms-assistant-panel-close {
	position: absolute;
	top: calc((var(--ui-header-height) - 28px) / 2);
	right: 8px;
}

.dms-assistant-panel-error {
	display: block;
	max-width: 320px;
	padding: 8px 10px;
	border-radius: 8px;
	background: var(--ui-bg-accented);
	color: var(--ui-text-highlighted);
	font: 500 12px var(--font-mono, ui-monospace, monospace);
	text-align: left;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.dms-assistant-panel-actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 6px;
}

.dms-assistant-panel-note {
	font-size: 12px;
	color: var(--ui-text-muted);
}

.dms-assistant-panel-spinner {
	width: 22px;
	height: 22px;
	border: 2px solid var(--dms-assistant-line);
	border-top-color: var(--ui-secondary);
	border-radius: 50%;
	animation: dms-assistant-spin 0.7s linear infinite;
}

@keyframes dms-assistant-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
