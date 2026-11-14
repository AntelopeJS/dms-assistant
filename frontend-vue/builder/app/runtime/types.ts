interface ValidationIssue {
	pointer: string
	message: string
}

interface TypecheckError {
	file: string
	line: number
	message: string
}

export type BuilderError =
	| { code: 'not_found'; ref: string }
	| { code: 'duplicate_name'; name: string; scope: string }
	| { code: 'invalid_config'; issues: ValidationIssue[] }
	| { code: 'opaque_target'; path: string }
	| { code: 'unsupported'; detail: string }
	| { code: 'referential_integrity'; blockedBy: string[] }
	| { code: 'stale'; ref: string; currentVersion: string }
	| { code: 'typecheck_failed'; diagnostics: TypecheckError[] }

interface FileChange {
	path: string
	kind: string
	diff: string
}

/**
 * Something an operation that went through still wants said: a column stored
 * as a string, a query kept because a block reads it, a route that moved.
 */
interface OpWarning {
	code: string
	message: string
}

export type OpResult<T> =
	| { ok: true; data: T; changes: FileChange[]; warnings?: OpWarning[] }
	| { ok: false; error: BuilderError }
