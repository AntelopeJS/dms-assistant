<script setup lang="ts">
import { computed } from "vue";
import { useAssistant } from "../composables/useAssistant";
import { useViewFormat } from "../composables/useViewFormat";
import type { ArtifactPayload } from "../types";
import ArtifactChart from "./ArtifactChart.vue";
import ArtifactKpis from "./ArtifactKpis.vue";
import ArtifactTable from "./ArtifactTable.vue";
import { parseArtifactSpec } from "./spec";

interface Props {
	artifact: ArtifactPayload;
}

const props = defineProps<Props>();

const { t } = useI18n();
const { moment } = useViewFormat();
const assistant = useAssistant();

/**
 * The artifact's data once the spec schema accepts it. Everything below is
 * drawn from these values by the templates, as text: no HTML of the artifact
 * is ever parsed.
 */
const spec = computed(() => parseArtifactSpec(props.artifact.spec));

const eyebrow = computed(() => {
	const parts = [
		t(`dms_assistant.views.artifacts.kind.${props.artifact.kind}`),
		moment(props.artifact.createdAtMs),
		t(`dms_assistant.views.agent.${props.artifact.agent}`),
	];
	if (props.artifact.createdBy)
		parts.push(
			t("dms_assistant.views.artifacts.created_by", {
				name: props.artifact.createdBy,
			}),
		);
	return parts.join(" · ");
});
</script>

<template>
	<article data-artifact>
		<header class="flex min-h-16 flex-wrap items-start gap-3 px-5 py-3.5">
			<div class="min-w-0 flex-1">
				<p
					class="text-secondary font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]"
				>
					✦ {{ eyebrow }}
				</p>
				<h2
					v-if="spec"
					class="text-highlighted mt-1 text-[15px] font-[650]"
					data-artifact-title
				>
					{{ spec.title }}
				</h2>
				<p v-if="spec?.summary" class="text-muted mt-1 text-[13px]">
					{{ spec.summary }}
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-1.5">
				<UButton
					v-if="assistant.isAvailable"
					icon="i-ph-chats-circle"
					color="neutral"
					variant="ghost"
					size="sm"
					:label="t('dms_assistant.views.artifacts.conversation')"
					@click="assistant.openConversation(artifact.conversationId)"
				/>
				<slot name="actions" />
			</div>
		</header>
		<DmsEmptyState
			v-if="spec === null"
			variant="error"
			icon="i-ph-warning-circle"
			:title="t('dms_assistant.views.artifacts.unreadable_title')"
			:description="t('dms_assistant.views.artifacts.unreadable_description')"
		/>
		<div
			v-else
			class="border-default flex flex-col gap-4 border-t px-5 py-4"
			data-artifact-blocks
		>
			<template v-for="(block, index) in spec.blocks" :key="index">
				<h3
					v-if="block.type === 'heading'"
					class="text-highlighted text-[14px] font-semibold"
				>
					{{ block.text }}
				</h3>
				<p
					v-else-if="block.type === 'paragraph'"
					class="text-toned whitespace-pre-line text-[13.5px] leading-relaxed"
				>
					{{ block.text }}
				</p>
				<ol
					v-else-if="block.type === 'list' && block.ordered"
					class="text-toned list-decimal pl-5 text-[13.5px]"
				>
					<li v-for="(item, itemIndex) in block.items" :key="itemIndex">
						{{ item }}
					</li>
				</ol>
				<ul
					v-else-if="block.type === 'list'"
					class="text-toned list-disc pl-5 text-[13.5px]"
				>
					<li v-for="(item, itemIndex) in block.items" :key="itemIndex">
						{{ item }}
					</li>
				</ul>
				<ArtifactKpis v-else-if="block.type === 'kpis'" :items="block.items" />
				<ArtifactTable v-else-if="block.type === 'table'" :block="block" />
				<ArtifactChart v-else-if="block.type === 'chart'" :block="block" />
			</template>
		</div>
	</article>
</template>
