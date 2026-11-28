<script setup lang="ts">
import UnavailableState from "../UnavailableState.vue";
import { useAiData } from "../composables/useAiData";
import { useArtifactActions } from "../composables/useArtifactActions";
import { AI_ROUTES } from "../constants";
import type { ArtifactPayload } from "../types";
import ArtifactView from "./ArtifactView.vue";

interface Props {
	artifactId: string;
}

interface Emits {
	/** The artifact was deleted: the list no longer holds it. */
	deleted: [artifactId: string];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const { t } = useI18n();
/** An artifact picked again shows what was read before and reads again. */
const detail = useAiData<ArtifactPayload>(
	() => `${AI_ROUTES.artifacts}/${encodeURIComponent(props.artifactId)}`,
);
const actions = useArtifactActions();

function load(): Promise<void> {
	return detail.refresh();
}

async function remove(): Promise<void> {
	if (await actions.remove(props.artifactId)) emit("deleted", props.artifactId);
}
</script>

<template>
	<div v-if="detail.failure.value && !detail.data.value" class="p-4">
		<UnavailableState
			:failure="detail.failure.value"
			:message="detail.message.value"
			@retry="load"
		/>
	</div>
	<div
		v-else-if="!detail.data.value"
		class="flex flex-col gap-3 p-5"
		:aria-busy="true"
		:aria-label="t('dms_assistant.views.common.loading')"
	>
		<USkeleton class="h-3 w-48" />
		<USkeleton class="h-5 w-72" />
		<USkeleton class="mt-4 h-40 w-full" />
	</div>
	<ArtifactView v-else :artifact="detail.data.value">
		<template #actions>
			<UButton
				icon="i-ph-trash"
				color="error"
				variant="outline"
				size="sm"
				:loading="actions.isBusy.value"
				:label="t('dms_assistant.views.artifacts.delete')"
				@click="remove"
			/>
		</template>
	</ArtifactView>
</template>
