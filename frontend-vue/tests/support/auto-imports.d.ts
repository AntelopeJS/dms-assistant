/**
 * The names the generated Inertia workspace auto-imports into this layer, typed
 * from their sources, so the type-aware lint reads them as the workspace does.
 * `tests` stays out of the published package and the workspace, so these
 * declarations never meet the workspace's own `auto-imports.d.ts`.
 */
declare global {
	const $fetch: (typeof import("ofetch"))["$fetch"];
	const getPluginI18n: (typeof import("#dms-core/app/composables/translation/useTranslation"))["getPluginI18n"];
	const refreshPageBlocks: (typeof import("#dms-ui/app/utils/blockRefresh"))["refreshPageBlocks"];
	const registerCommandPaletteAssistant: (typeof import("#dms-layout/app/composables/useCommandPaletteAssistant"))["registerCommandPaletteAssistant"];
	const registerCommandPaletteSource: (typeof import("#dms-layout/app/composables/useCommandPaletteSources"))["registerCommandPaletteSource"];
	const registerHeaderAction: (typeof import("#dms-layout/app/composables/useHeaderActions"))["registerHeaderAction"];
	const registerSidePanel: (typeof import("#dms-ui/app/composables/useAppSidePanels"))["registerSidePanel"];
	const unregisterCommandPaletteAssistant: (typeof import("#dms-layout/app/composables/useCommandPaletteAssistant"))["unregisterCommandPaletteAssistant"];
	const unregisterCommandPaletteSource: (typeof import("#dms-layout/app/composables/useCommandPaletteSources"))["unregisterCommandPaletteSource"];
	const unregisterSidePanel: (typeof import("#dms-ui/app/composables/useAppSidePanels"))["unregisterSidePanel"];
	const useApiData: (typeof import("#dms-core/app/composables/auth/useApiData"))["useApiData"];
	const useApiPagedData: (typeof import("#dms-core/app/composables/auth/useApiData"))["useApiPagedData"];
	const useApiErrorPresenter: (typeof import("#dms-core/app/composables/useApiErrorPresenter"))["useApiErrorPresenter"];
	const useAuthFetch: (typeof import("#dms-core/app/composables/auth/useAuthFetch"))["useAuthFetch"];
	const useToast: () => {
		add: (toast: {
			title?: string;
			description?: string;
			color?: string;
			icon?: string;
			actions?: {
				label: string;
				icon?: string;
				color?: string;
				variant?: string;
				onClick: () => void;
			}[];
		}) => { id: string | number };
	};
	const useConfirmFrom: (typeof import("#dms-ui/app/composables/confirm/useConfirmFrom"))["useConfirmFrom"];
	const useDevReload: (typeof import("#dms-layout/app/composables/useDevReload"))["useDevReload"];
	const useRegionalFormat: (typeof import("#dms-core/app/composables/user/useRegionalFormat"))["useRegionalFormat"];
	const useSidePanel: (typeof import("#dms-ui/app/composables/useSidePanel"))["useSidePanel"];
	const useDmsAsyncData: (typeof import("#dms/frontend-module"))["useDmsAsyncData"];
	const useDmsFetch: (typeof import("#dms/frontend-module"))["useDmsFetch"];
	const useDmsPagedData: (typeof import("#dms/frontend-module"))["useDmsPagedData"];
	const useDmsState: (typeof import("#dms/frontend-module"))["useDmsState"];
	const useDmsUserSession: (typeof import("#dms/frontend-module"))["useDmsUserSession"];
	const useI18n: (typeof import("#dms/frontend-module"))["useI18n"];
}

export {};
