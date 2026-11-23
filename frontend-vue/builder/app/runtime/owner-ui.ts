/**
 * The header the assistant's own client sends on every request that hands the module a connection
 * target or a secret; the module refuses those requests without it. The value pairs with
 * `OWNER_UI_HEADER` and `OWNER_UI_VALUE` in `src/routes/owner-ui.ts`.
 */
export const OWNER_UI_HEADERS = { 'x-dms-ui-assistant': '1' } as const
