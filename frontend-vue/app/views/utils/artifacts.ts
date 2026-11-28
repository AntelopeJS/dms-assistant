import { ARTIFACT_QUERY_KEY } from "../constants";
import type { ArtifactKind } from "../types";

const KIND_ICONS: Record<ArtifactKind, string> = {
	report: "i-ph-file-text",
	table: "i-ph-table",
	chart: "i-ph-chart-bar",
};

/** The list node of an artifact: its kind. */
export function artifactIcon(kind: ArtifactKind): string {
	return KIND_ICONS[kind];
}

/**
 * Keeps the selected artifact in the URL without a visit, so a reload or a
 * shared link opens it again; none clears it.
 */
export function writeSelectedArtifact(artifactId: string | undefined): void {
	const url = new URL(window.location.href);
	if (artifactId === undefined) url.searchParams.delete(ARTIFACT_QUERY_KEY);
	else url.searchParams.set(ARTIFACT_QUERY_KEY, artifactId);
	window.history.replaceState(window.history.state, "", url);
}
