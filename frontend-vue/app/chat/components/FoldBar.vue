<script setup lang="ts">
import { computed, type Ref } from "vue";
import type { LauncherState } from "../../runtime/launcher-state";
import { useChatI18n } from "../composables/useChatI18n";
import { shortcutLabel } from "../utils/platform";

interface Props {
	isFolded: Readonly<Ref<boolean>>;
	state: Readonly<Ref<LauncherState>>;
	onUnfold: () => void;
}

const props = defineProps<Props>();
const { t } = useChatI18n();

const TOGGLE_KEY = "k";

const label = computed(
	() =>
		`${t("dms_assistant.panel.fold.open")} (${shortcutLabel(TOGGLE_KEY, true)})`,
);
</script>

<template>
	<Transition name="dms-assistant-fold">
		<aside
			v-if="props.isFolded.value"
			class="dms-assistant-chat-tokens dms-assistant-fold"
			:data-state="props.state.value"
		>
			<button
				type="button"
				class="dms-assistant-fold__button"
				:aria-label="label"
				:title="label"
				@click="props.onUnfold"
			>
				<span class="dms-assistant-fold__tile" aria-hidden="true">
					<UIcon name="i-ph-sparkle" />
				</span>
				<span class="dms-assistant-fold__dot" aria-hidden="true" />
				<span class="dms-assistant-fold__name">
					{{ t("dms_assistant.panel.assistant") }}
				</span>
				<UIcon
					name="i-ph-caret-double-left"
					class="dms-assistant-fold__caret"
				/>
			</button>
		</aside>
	</Transition>
</template>

<style scoped>
.dms-assistant-fold {
	position: fixed;
	top: var(--ui-header-height);
	right: 0;
	bottom: 0;
	z-index: 40;
	width: 40px;
	border-left: 1px solid var(--ui-border);
	background: var(--dms-bg-sidebar, var(--ui-bg));
}

.dms-assistant-fold__button {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
	width: 100%;
	height: 100%;
	padding: 10px 0;
	border: 0;
	background: transparent;
	color: var(--ui-text-muted);
	cursor: pointer;
}

.dms-assistant-fold__button:hover {
	background: var(--ai-bg-hover);
	color: var(--ui-text-highlighted);
}

.dms-assistant-fold__button:focus-visible {
	outline: 2px solid var(--ui-primary);
	outline-offset: -2px;
}

.dms-assistant-fold__tile {
	display: grid;
	place-items: center;
	width: 26px;
	height: 26px;
	border-radius: var(--ai-radius-sm);
	background: var(--ai-tint);
	box-shadow: inset 0 0 0 1px var(--ai-line);
	color: var(--ai);
	font-size: 14px;
}

.dms-assistant-fold__dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--ui-success);
}

.dms-assistant-fold[data-state="working"] .dms-assistant-fold__dot {
	background: var(--ai);
	animation: dms-assistant-fold-pulse 1.2s ease-in-out infinite;
}

.dms-assistant-fold[data-state="question"] .dms-assistant-fold__dot {
	background: var(--ui-warning);
}

.dms-assistant-fold[data-state="disconnected"] .dms-assistant-fold__dot {
	background: var(--ui-error);
}

.dms-assistant-fold__name {
	writing-mode: vertical-rl;
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.02em;
}

.dms-assistant-fold__caret {
	width: 14px;
	height: 14px;
	margin-top: auto;
}

.dms-assistant-fold-enter-active,
.dms-assistant-fold-leave-active {
	transition:
		transform 180ms ease,
		opacity 180ms ease;
}

.dms-assistant-fold-enter-from,
.dms-assistant-fold-leave-to {
	transform: translateX(100%);
	opacity: 0;
}

@keyframes dms-assistant-fold-pulse {
	50% {
		opacity: 0.35;
	}
}

@media (prefers-reduced-motion: reduce) {
	.dms-assistant-fold-enter-active,
	.dms-assistant-fold-leave-active {
		transition: none;
	}

	.dms-assistant-fold[data-state="working"] .dms-assistant-fold__dot {
		animation: none;
	}
}
</style>
