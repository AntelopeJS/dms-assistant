import { describe, expect, it } from 'vitest'
import { isBuilderEnabled } from '../app/runtime/enabled'

describe('whether the backend turned the builder on', () => {
	it('is on only for an explicit true under the builder key', () => {
		expect(isBuilderEnabled({ dmsBuilder: { enabled: true } })).toBe(true)
	})

	it('is off for anything else the registration could carry', () => {
		expect(isBuilderEnabled(undefined)).toBe(false)
		expect(isBuilderEnabled({})).toBe(false)
		expect(isBuilderEnabled({ dmsBuilder: null })).toBe(false)
		expect(isBuilderEnabled({ dmsBuilder: { enabled: 'true' } })).toBe(false)
		expect(isBuilderEnabled({ dmsBuilder: { enabled: 1 } })).toBe(false)
		expect(isBuilderEnabled({ enabled: true })).toBe(false)
	})
})
