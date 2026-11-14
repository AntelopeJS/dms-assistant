import type { DatabaseEngine } from "../../builder/app/runtime/database-connect";
import type { DatabaseAccess } from "../../builder/app/runtime/database-types";
import { CONNECTABLE_ENGINES } from "./connect-database";

/**
 * A connection the popup wrote into the project and follows until its analysis is ready. The tab
 * keeps it so that a reload of the page, or the popup closed and opened again, follows it again.
 * The URL is never kept: it holds the password.
 */
export interface WrittenConnection {
	engine: DatabaseEngine;
	connection: string;
	module: string;
	/** The live check's answer before the write. */
	access: DatabaseAccess;
}

export interface ConnectMemory {
	read: () => WrittenConnection | null;
	write: (written: WrittenConnection) => void;
	clear: () => void;
}

export const CONNECT_MEMORY_KEY = "dms-assistant:onboarding-connect";

function textOf(value: object, key: string): string | undefined {
	const field: unknown = Reflect.get(value, key);
	return typeof field === "string" ? field : undefined;
}

function accessOf(value: unknown): DatabaseAccess | null {
	if (value === null || typeof value !== "object") return null;
	const reachable: unknown = Reflect.get(value, "reachable");
	const canRead: unknown = Reflect.get(value, "canRead");
	const canWrite: unknown = Reflect.get(value, "canWrite");
	const latencyMs: unknown = Reflect.get(value, "latencyMs");
	if (
		typeof reachable !== "boolean" ||
		typeof canRead !== "boolean" ||
		typeof canWrite !== "boolean"
	) {
		return null;
	}
	return {
		reachable,
		canRead,
		canWrite,
		latencyMs: typeof latencyMs === "number" ? latencyMs : undefined,
		user: textOf(value, "user"),
		reason: textOf(value, "reason"),
	};
}

function parsed(text: string | null): WrittenConnection | null {
	if (text === null) return null;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (value === null || typeof value !== "object") return null;
	const stored = textOf(value, "engine");
	const engine = CONNECTABLE_ENGINES.find((known) => known === stored);
	const connection = textOf(value, "connection");
	const module = textOf(value, "module");
	const access = accessOf(Reflect.get(value, "access"));
	if (
		engine === undefined ||
		connection === undefined ||
		module === undefined ||
		access === null
	) {
		return null;
	}
	return { engine, connection, module, access };
}

/** The written connection in `storage`, the tab's `sessionStorage`; a storage that refuses keeps none. */
export function connectMemory(storage: () => Storage): ConnectMemory {
	return {
		read: () => {
			try {
				return parsed(storage().getItem(CONNECT_MEMORY_KEY));
			} catch {
				return null;
			}
		},
		write: (written) => {
			try {
				storage().setItem(CONNECT_MEMORY_KEY, JSON.stringify(written));
			} catch {
				return;
			}
		},
		clear: () => {
			try {
				storage().removeItem(CONNECT_MEMORY_KEY);
			} catch {
				return;
			}
		},
	};
}
