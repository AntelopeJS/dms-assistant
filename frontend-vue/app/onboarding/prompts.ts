/**
 * The first message "Start the mockup" sends: the developer's description, after what the
 * assistant should do with it. Prompts to the agent stay in English, as the builder's do.
 */
export function mockupPrompt(description: string): string {
	return `Draft a live mockup of this back office. Ask what you need first, then show me the mockup.\n\n${description.trim()}`;
}

/** A screen the analysis proposed, as the developer ticked it. */
export interface ChosenScreen {
	relation: string;
	title: string;
}

/** The first message "Generate a first mockup" sends: the connection and the screens ticked. */
export function databaseMockupPrompt(
	connection: string,
	module: string,
	screens: readonly ChosenScreen[],
): string {
	const list = screens
		.map((screen) => `- ${screen.title} (${screen.relation})`)
		.join("\n");
	return `Use dms-external-database on connection ${connection}, module ${module}. The connection is live and analysed. Draft a first live mockup of these screens from its data, before building anything:\n${list}`;
}
