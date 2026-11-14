import {
	connectionId,
	type DatabaseEngine,
	tablesModuleOf,
} from "../../builder/app/runtime/database-connect";
import type { DatabaseAccess } from "../../builder/app/runtime/database-types";
import { CONNECTABLE_ENGINES } from "./connect-database";

/**
 * A connection the popup wrote into the project and follows until its analysis is ready. The tab
 * keeps it so that a reload of the page, or the popup closed and opened again, follows it again.
 * The URL is never kept: it holds the password.
 */
export interface WrittenConnection {
	engine: DatabaseEngine;
	/** The connection id the popup named after the URL's database. */
	connection: string;
	/** The live check's answer before the write. */
	access: DatabaseAccess;
}

/** A written connection as the tab remembers it. */
export interface RememberedConnection extends WrittenConnection {
	/** The tables module the builder names after the connection. */
	module: string;
	/** When following it again ends, in milliseconds since the epoch: past it, the popup starts over. */
	until: number;
}

/**
 * The tab's connect attempts and the connection the latest one wrote, for the signed-in user. Every
 * popup of the tab shares it, so a write that answers after a later attempt began, in this popup or
 * one opened since, is not kept.
 */
export interface ConnectMemory {
	/**
	 * The connection the signed-in user's latest attempt wrote, until {@link CONNECT_MEMORY_LIMIT_MS}
	 * after the write; null for another user or another project's user.
	 */
	read: () => RememberedConnection | null;
	/** Starts an attempt: forgets the written connection and every earlier attempt. */
	begin: () => string;
	/** Keeps the connection `attempt` wrote, unless a later attempt began or `clear` ran since. */
	write: (attempt: string, written: WrittenConnection) => void;
	clear: () => void;
}

/** How long after its write a connection is followed again: past it, the popup starts over. */
export const CONNECT_MEMORY_LIMIT_MS = 15 * 60_000;

export const CONNECT_MEMORY_KEY = "dms-assistant:onboarding-connect";

interface Kept extends WrittenConnection {
	writtenAt: number;
}

interface Stored {
	owner: string | null;
	attempt: string;
	written?: Kept;
}

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

function isConnectionId(text: string | undefined): text is string {
	return text !== undefined && text !== "" && connectionId(text) === text;
}

function keptOf(value: unknown): Kept | null {
	if (value === null || typeof value !== "object") return null;
	const stored = textOf(value, "engine");
	const engine = CONNECTABLE_ENGINES.find((known) => known === stored);
	const connection = textOf(value, "connection");
	const access = accessOf(Reflect.get(value, "access"));
	const writtenAt: unknown = Reflect.get(value, "writtenAt");
	if (
		engine === undefined ||
		!isConnectionId(connection) ||
		access === null ||
		typeof writtenAt !== "number"
	) {
		return null;
	}
	return { engine, connection, access, writtenAt };
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
	const owner = textOf(value, "owner") ?? null;
	const written = keptOf(Reflect.get(value, "written"));
	return written === null ? { owner, attempt } : { owner, attempt, written };
}

function newAttempt(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** The storage calls the memory makes; the tab's `sessionStorage` provides them. */
export type ConnectStorage = Pick<
	Storage,
	"getItem" | "setItem" | "removeItem"
>;

/**
 * The connect attempts in `storage`, the tab's `sessionStorage`, for `owner`: the signed-in user's
 * id, which the project's own database issues, so it tells projects and users apart. A storage
 * that refuses keeps none.
 */
export function connectMemory(
	storage: () => ConnectStorage,
	owner: () => string | null,
): ConnectMemory {
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
		read: () => {
			const current = stored();
			const written = current?.written;
			if (
				written === undefined ||
				current?.owner === null ||
				current?.owner !== owner()
			) {
				return null;
			}
			const until = written.writtenAt + CONNECT_MEMORY_LIMIT_MS;
			if (Date.now() >= until) return null;
			const { engine, connection, access } = written;
			return {
				engine,
				connection,
				access,
				module: tablesModuleOf(connection),
				until,
			};
		},
		begin: () => {
			const attempt = newAttempt();
			keep({ owner: owner(), attempt });
			return attempt;
		},
		write: (attempt, written) => {
			const current = stored();
			if (current?.attempt !== attempt) return;
			keep({ ...current, written: { ...written, writtenAt: Date.now() } });
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
