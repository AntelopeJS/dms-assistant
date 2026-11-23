import { type Ref, ref } from "vue";
import { z } from "zod";
import { SERVER_EVENT_TYPES } from "../constants/protocol";
import { DEFAULT_SETTINGS } from "../constants/settings";
import type { AppSettings, ProviderAvailability } from "../types/settings";
import { parseEvent, type WireEnvelope } from "../utils/wire-envelope";
import {
	APPROVAL_MODE_SCHEMA,
	PROVIDER_NAME_SCHEMA,
	SCOPE_SCHEMA,
} from "../utils/wire-schemas";

export interface UseSettingsOptions {
	onMessage: (handler: (msg: WireEnvelope) => void) => () => void;
}

export interface UseSettingsResult {
	settings: Ref<AppSettings>;
}

const PROVIDER_AVAILABILITY_SCHEMA: z.ZodType<ProviderAvailability> = z.object({
	available: z.boolean(),
	reason: z.string().optional(),
	code: z.literal("codex_not_signed_in").optional(),
});

const SETTINGS_UPDATE_SCHEMA = z.object({
	settings: z
		.object({
			provider: PROVIDER_NAME_SCHEMA,
			defaultModes: z.object({
				claude: APPROVAL_MODE_SCHEMA,
				codex: APPROVAL_MODE_SCHEMA,
			}),
			thinking: z.enum(["off", "low", "medium", "high"]),
			generationMode: SCOPE_SCHEMA,
			allowLocalSkills: z.boolean(),
			notifyRequests: z.boolean(),
			requestTimeoutMinutes: z.number(),
		})
		.partial()
		.optional(),
	builderAvailable: z.boolean().optional(),
	providers: z
		.object({
			claude: PROVIDER_AVAILABILITY_SCHEMA,
			codex: PROVIDER_AVAILABILITY_SCHEMA,
		})
		.optional(),
});

type SettingsUpdateEvent = z.infer<typeof SETTINGS_UPDATE_SCHEMA>;

/** The pushed settings over the defaults. */
function readSettings(event: SettingsUpdateEvent): AppSettings {
	return {
		...DEFAULT_SETTINGS,
		...event.settings,
		builderAvailable: event.builderAvailable ?? false,
		providers: event.providers ?? DEFAULT_SETTINGS.providers,
	};
}

/** The sidecar's settings, as it pushes them; the Settings page edits them. */
export function useSettings(options: UseSettingsOptions): UseSettingsResult {
	const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS });

	options.onMessage((envelope) => {
		if (envelope.type !== SERVER_EVENT_TYPES.SETTINGS_UPDATE) return;
		const event = parseEvent(SETTINGS_UPDATE_SCHEMA, envelope);
		if (event !== null) settings.value = readSettings(event);
	});

	return { settings };
}
