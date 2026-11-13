/**
 * Where the option the backend publishes lands in the module's public options.
 * The loader nests a module's manifest options under its `configKey`, so these
 * two names mirror `FRONTEND_MODULE_CONFIG_KEY` and
 * `FRONTEND_MODULE_ENABLED_OPTION` in `src/builder/constants/routes.ts`.
 */
const CONFIG_KEY = 'dmsBuilder'
const ENABLED_OPTION = 'enabled'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/**
 * Whether the backend turned the builder on, read from the module's public
 * options. A frontend is built once and served later, so this reads the
 * registration it is served with rather than the Vite build mode. Anything
 * other than an explicit `true` means off.
 */
export function isBuilderEnabled(options: Record<string, unknown> | undefined): boolean {
	const scoped = options?.[CONFIG_KEY]
	return isRecord(scoped) && scoped[ENABLED_OPTION] === true
}
