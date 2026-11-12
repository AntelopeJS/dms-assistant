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
	() => `${t("dms_ai.panel.fold.open")} (${shortcutLabel(TOGGLE_KEY, true)})`,
);
</script>

<template>
	<Transition name="dms-ai-fold">
		<aside
			v-if="props.isFolded.value"
			class="dms-ai-chat-tokens dms-ai-fold"
			:data-state="props.state.value"
		>
			<button
				type="button"
				class="dms-ai-fold__button"
				:aria-label="label"
				:title="label"
				@click="props.onUnfold"
			>
				<span class="dms-ai-fold__tile" aria-hidden="true">
					<UIcon name="i-ph-sparkle" />
				</span>
				<span class="dms-ai-fold__dot" aria-hidden="true" />
				<span class="dms-ai-fold__name">{{ t("dms_ai.panel.fold.name") }}</span>
				<UIcon name="i-ph-caret-double-left" class="dms-ai-fold__caret" />
			</button>
		</aside>
	</Transition>
</template>

<style scoped>
.dms-ai-fold {
	position: fixed;
	top: var(--ui-header-height);
	right: 0;
	bottom: 0;
	z-index: 40;
	width: 40px;
	border-left: 1px solid var(--ui-border);
	background: var(--dms-bg-sidebar, var(--ui-bg));
}

.dms-ai-fold__button {
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

.dms-ai-fold__button:hover {
	background: var(--ai-bg-hover);
	color: var(--ui-text-highlighted);
}

.dms-ai-fold__button:focus-visible {
	outline: 2px solid var(--ui-primary);
	outline-offset: -2px;
}

.dms-ai-fold__tile {
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

.dms-ai-fold__dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--ui-success);
}

.dms-ai-fold[data-state="working"] .dms-ai-fold__dot {
	background: var(--ai);
	animation: dms-ai-fold-pulse 1.2s ease-in-out infinite;
}

.dms-ai-fold[data-state="question"] .dms-ai-fold__dot {
	background: var(--ui-warning);
}

.dms-ai-fold[data-state="disconnected"] .dms-ai-fold__dot {
	background: var(--ui-error);
}

.dms-ai-fold__name {
	writing-mode: vertical-rl;
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.02em;
}

.dms-ai-fold__caret {
	width: 14px;
	height: 14px;
	margin-top: auto;
}

.dms-ai-fold-enter-active,
.dms-ai-fold-leave-active {
	transition:
		transform 180ms ease,
		opacity 180ms ease;
}

.dms-ai-fold-enter-from,
.dms-ai-fold-leave-to {
	transform: translateX(100%);
	opacity: 0;
}

@keyframes dms-ai-fold-pulse {
	50% {
		opacity: 0.35;
	}
}

@media (prefers-reduced-motion: reduce) {
	.dms-ai-fold-enter-active,
	.dms-ai-fold-leave-active {
		transition: none;
	}

	.dms-ai-fold[data-state="working"] .dms-ai-fold__dot {
		animation: none;
	}
}
</style>
