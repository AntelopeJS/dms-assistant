import * as z from "zod/mini";

/**
 * The event the mockup editor of the DMS dispatches on `window` to hand a
 * prompt to the assistant. Mirrors `MOCKUP_ASSISTANT_PROMPT_EVENT` of dms until
 * dms exports it.
 */
export const MOCKUP_ASSISTANT_PROMPT_EVENT = "dms:assistant-prompt";

const MAX_TEXT_LENGTH = 20_000;
const MAX_NAME_LENGTH = 500;

const NameSchema = z
	.string()
	.check(z.minLength(1), z.maxLength(MAX_NAME_LENGTH));

/** The mockup block a prompt is about, in the spec's own terms. */
export const MockupBlockSchema = z.object({
	mockup: NameSchema,
	page: NameSchema,
	path: NameSchema,
	type: z.optional(NameSchema),
});

const PromptSourceSchema = z.enum(["connect-data", "custom-zone"]);

const BlockPromptSchema = z.object({
	prompt: z.string().check(z.maxLength(MAX_TEXT_LENGTH)),
	block: z.optional(MockupBlockSchema),
	source: PromptSourceSchema,
});

/**
 * "Build it": `prompt` is the name of the mockup to build, and no block is
 * sent. `target.pageRef` names an existing page to build into ("Edit as
 * mockup"), which the build updates instead of creating a page.
 */
const BuildPromptSchema = z.object({
	prompt: NameSchema,
	source: z.literal("build"),
	target: z.optional(z.object({ pageRef: NameSchema })),
});

/**
 * "Resolve with AI": `prompt` is the name of the mockup whose open comments
 * the assistant applies and resolves. `page` limits the run to the comments of
 * one page of its spec.
 */
const ResolveCommentsPromptSchema = z.object({
	prompt: NameSchema,
	source: z.literal("resolve-comments"),
	page: z.optional(NameSchema),
});

/**
 * "+ New mockup": `prompt` is the start of a sentence the user finishes, such
 * as "Draft a mockup of ". It opens a new conversation and is never sent.
 */
const NewMockupPromptSchema = z.object({
	prompt: z.string().check(z.minLength(1), z.maxLength(MAX_TEXT_LENGTH)),
	source: z.literal("new-mockup"),
});

/** The `detail` of {@link MOCKUP_ASSISTANT_PROMPT_EVENT}. Mirrors `MockupAssistantPrompt` of dms. */
export const MockupAssistantPromptSchema = z.union([
	BuildPromptSchema,
	ResolveCommentsPromptSchema,
	NewMockupPromptSchema,
	BlockPromptSchema,
]);

export type MockupBlock = z.infer<typeof MockupBlockSchema>;
export type MockupAssistantPrompt = z.infer<typeof MockupAssistantPromptSchema>;

/**
 * Takes every {@link MOCKUP_ASSISTANT_PROMPT_EVENT} whose detail parses, and
 * cancels it so the editor keeps its copy-the-prompt fallback closed. A detail
 * that does not parse is left to the editor.
 */
export function installAssistantPromptListener(
	onPrompt: (prompt: MockupAssistantPrompt) => void,
): () => void {
	const handler = (event: Event): void => {
		if (!(event instanceof CustomEvent)) return;
		const parsed = MockupAssistantPromptSchema.safeParse(event.detail);
		if (!parsed.success) return;
		event.preventDefault();
		onPrompt(parsed.data);
	};
	window.addEventListener(MOCKUP_ASSISTANT_PROMPT_EVENT, handler);
	return () =>
		window.removeEventListener(MOCKUP_ASSISTANT_PROMPT_EVENT, handler);
}
