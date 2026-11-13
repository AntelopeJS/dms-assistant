/**
 * The DMS's list of components it mounts over every page, by name. Owned by the
 * host and declared here so this layer carries no build-time dependency on the
 * core layers: the key and the shape are the whole contract.
 */
export const APP_OVERLAYS_STATE_KEY = 'dms-app-overlays'

export const API_PREFIX = '/api/builder'
