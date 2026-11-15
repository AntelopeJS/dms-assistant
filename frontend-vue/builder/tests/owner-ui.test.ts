import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBuilderApi } from '../app/runtime/api'

afterEach(() => vi.unstubAllGlobals())

function recordingApi() {
	const calls: { path: string; options: { method?: string; headers?: Record<string, string> } }[] = []
	vi.stubGlobal('useApiErrorPresenter', () => ({ presentError: () => undefined, resolveError: () => undefined }))
	vi.stubGlobal('useAuthFetch', () => ({
		$authFetch: async (path: string, options: { method?: string; headers?: Record<string, string> }) => {
			calls.push({ path, options })
			return { ok: true, data: {}, changes: [] }
		},
	}))
	return { api: useBuilderApi(), calls }
}

describe('the builder client', () => {
	/** Fails on a client that sends a URL-taking request without the header the module requires, which the module would refuse. */
	it('sends the assistant UI header on the connection check and on a builder POST', async () => {
		const { api, calls } = recordingApi()
		await api.checkConnection('postgres', 'postgres://u:p@h/db')
		await api.analyseDatabase('erp', 'erp')
		expect(calls.map((call) => [call.path, call.options.method, call.options.headers?.['x-dms-ui-assistant']])).toEqual([
			['/api/builder/database/connections/check', 'POST', '1'],
			['/api/builder/database/analyse', 'POST', '1'],
		])
	})
})
