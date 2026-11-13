<script setup lang="ts">
import { computed } from "vue";
import { useChatI18n } from "../composables/useChatI18n";
import type {
	BuildOutcome,
	BuildStep,
	BuildStepState,
	BuildView,
} from "../utils/build-view";
import { toolVerb } from "../utils/tool-lexicon";
import BlockPreviewCard from "./BlockPreviewCard.vue";

interface Props {
	view: BuildView;
}

interface Emits {
	background: [];
	openPages: [path: string];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const { t } = useChatI18n();

const STATE_ICONS: Record<Exclude<BuildStepState, "running">, string> = {
	done: "i-ph-check-circle-fill",
	pending: "i-ph-circle",
	failed: "i-ph-x-circle-fill",
	stopped: "i-ph-stop-circle",
};

const TITLE_KEYS: Record<BuildOutcome, string> = {
	running: "dms_ai.panel.build.title",
	built: "dms_ai.panel.build.title_done",
	failed: "dms_ai.panel.build.title_failed",
	stopped: "dms_ai.panel.build.title_stopped",
};

const title = computed(() =>
	t(TITLE_KEYS[props.view.outcome], { mockup: props.view.mockup }),
);

function label(step: BuildStep): string {
	if (step.kind === "todo") return step.text;
	const verb = toolVerb(step.tool, t);
	return step.tool.target === "" ? verb : `${verb} · ${step.tool.target}`;
}

function openPages(): void {
	if (props.view.pagePath !== null) emit("openPages", props.view.pagePath);
}

function onOpenChange(isOpen: boolean): void {
	if (!isOpen) emit("background");
}
</script>

<template>
	<UModal
		:open="true"
		:title="title"
		:description="t('dms_ai.panel.build.description')"
		:ui="{ content: 'sm:max-w-2xl' }"
		@update:open="onOpenChange"
	>
		<template #body>
			<div class="dms-ai-chat-tokens cb-build">
				<ol class="cb-build__steps" :aria-label="t('dms_ai.panel.build.steps')">
					<li
						v-for="step in view.steps"
						:key="step.key"
						class="cb-build__step"
						:data-state="step.state"
					>
						<span
							v-if="step.state === 'running'"
							class="spin-ai"
							aria-hidden="true"
						/>
						<UIcon
							v-else
							:name="STATE_ICONS[step.state]"
							class="cb-build__icon"
						/>
						<span class="cb-build__label">{{ label(step) }}</span>
					</li>
					<li v-if="view.steps.length === 0" class="cb-build__step">
						<span class="spin-ai" aria-hidden="true" />
						<span class="cb-build__label">
							{{ t("dms_ai.panel.build.starting") }}
						</span>
					</li>
				</ol>
				<BlockPreviewCard
					v-if="view.comparison"
					:preview="view.comparison.preview"
					:reference="view.reference"
				/>
			</div>
		</template>
		<template #footer>
			<div class="cb-build__foot">
				<UButton
					v-if="view.outcome === 'running'"
					color="neutral"
					variant="ghost"
					:label="t('dms_ai.panel.build.background')"
					@click="emit('background')"
				/>
				<UButton
					v-else
					color="neutral"
					variant="ghost"
					:label="t('dms_ai.panel.build.close')"
					@click="emit('background')"
				/>
				<UButton
					color="primary"
					icon="i-ph-arrow-square-out"
					:disabled="view.outcome !== 'built' || view.pagePath === null"
					:label="t('dms_ai.panel.build.open_pages')"
					@click="openPages"
				/>
			</div>
		</template>
	</UModal>
</template>

<style scoped>
.cb-build {
	display: flex;
	flex-direction: column;
	gap: 14px;
}

.cb-build__steps {
	display: flex;
	flex-direction: column;
	gap: 7px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.cb-build__step {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13px;
	color: var(--ui-text-toned);
}

.cb-build__step[data-state="pending"] {
	color: var(--ui-text-dimmed);
}

.cb-build__icon {
	width: 16px;
	height: 16px;
	flex: none;
}

.cb-build__step[data-state="done"] .cb-build__icon {
	color: var(--ui-success);
}

.cb-build__step[data-state="failed"] .cb-build__icon {
	color: var(--ui-error);
}

.cb-build__label {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.cb-build__foot {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	width: 100%;
}
</style>
