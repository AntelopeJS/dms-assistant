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

/**
 * The tab's connect attempts and the connection the latest one wrote. Every popup of the tab shares
 * it, so a write that answers after a later attempt began, in this popup or one opened since, is
 * not kept.
 */
export interface ConnectMemory {
	read: () => WrittenConnection | null;
	/** Starts an attempt: forgets the written connection and every earlier attempt. */
	begin: () => string;
	/** Keeps the connection `attempt` wrote, unless a later attempt began or `clear` ran since. */
	write: (attempt: string, written: WrittenConnection) => void;
	clear: () => void;
}

interface Stored {
	attempt: string;
	written?: WrittenConnection;
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

function writtenOf(value: unknown): WrittenConnection | null {
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

function parsed(text: string | null): Stored | null {
	if (text === null) return null;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (value === null || typeof value !== "object") return null;
	const attempt = textOf(value, "attempt");
	if (attempt === undefined) return null;
	const written = writtenOf(Reflect.get(value, "written"));
	return written === null ? { attempt } : { attempt, written };
}

function newAttempt(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** The storage calls the memory makes; the tab's `sessionStorage` provides them. */
export type ConnectStorage = Pick<
	Storage,
	"getItem" | "setItem" | "removeItem"
>;

/** The connect attempts in `storage`, the tab's `sessionStorage`; a storage that refuses keeps none. */
export function connectMemory(storage: () => ConnectStorage): ConnectMemory {
	function stored(): Stored | null {
		try {
			return parsed(storage().getItem(CONNECT_MEMORY_KEY));
		} catch {
			return null;
		}
	}

	function keep(next: Stored): void {
		try {
			storage().setItem(CONNECT_MEMORY_KEY, JSON.stringify(next));
		} catch {
			return;
		}
	}

	return {
		read: () => stored()?.written ?? null,
		begin: () => {
			const attempt = newAttempt();
			keep({ attempt });
			return attempt;
		},
		write: (attempt, written) => {
			if (stored()?.attempt === attempt) keep({ attempt, written });
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
