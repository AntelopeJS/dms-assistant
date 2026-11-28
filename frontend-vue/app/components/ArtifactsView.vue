<script setup lang="ts">
import { computed } from "vue";
import { z } from "zod";
import { useDmsRoute } from "#dms/frontend-module";
import ArtifactView from "../views/artifacts/ArtifactView.vue";
import UnavailableState from "../views/UnavailableState.vue";
import { useAiData } from "../views/composables/useAiData";
import { useAssistant } from "../views/composables/useAssistant";
import { AI_ROUTES, ARTIFACT_QUERY_KEY } from "../views/constants";
import type { ArtifactPayload } from "../views/types";

const { t } = useI18n();
const assistant = useAssistant();
const route = useDmsRoute();

const ROUTE_ID_SCHEMA = z.string().min(1);

/** The artifact the URL names (`?artifact=<id>`), as the assistant's link opens it. */
const artifactId = computed(() => {
	const id = ROUTE_ID_SCHEMA.safeParse(route.query[ARTIFACT_QUERY_KEY]);
	return id.success ? id.data : undefined;
});

/** Read with the page: a server render shows the artifact at once. */
const detail = useAiData<ArtifactPayload>(() =>
	artifactId.value
		? `${AI_ROUTES.artifacts}/${encodeURIComponent(artifactId.value)}`
		: null,
);

function reload(): Promise<void> {
	return detail.refresh();
}

const emptyActions = computed(() =>
	assistant.isAvailable
		? [
				{
					label: t("dms_assistant.views.common.open_assistant"),
					icon: "i-ph-sparkle",
					color: "secondary" as const,
					onClick: () => assistant.openPanel(),
				},
			]
		: [],
);
</script>

<template>
	<DmsCardPanel v-if="!artifactId" :padded="false">
		<DmsEmptyState
			icon="i-ph-presentation-chart"
			:title="t('dms_assistant.views.artifacts.empty_title')"
			:description="t('dms_assistant.views.artifacts.empty_description')"
			:actions="emptyActions"
		/>
	</DmsCardPanel>
	<DmsCardPanel v-else-if="detail.failure.value" :padded="false">
		<UnavailableState
			:failure="detail.failure.value"
			:message="detail.message.value"
			@retry="reload"
		/>
	</DmsCardPanel>
	<DmsCardPanel
		v-else-if="!detail.data.value"
		class="flex flex-col gap-3"
		:aria-busy="true"
		:aria-label="t('dms_assistant.views.common.loading')"
	>
		<USkeleton class="h-3 w-48" />
		<USkeleton class="h-5 w-72" />
		<USkeleton class="mt-4 h-40 w-full" />
	</DmsCardPanel>
	<DmsCardPanel v-else :padded="false">
		<ArtifactView :artifact="detail.data.value" />
	</DmsCardPanel>
</template>
