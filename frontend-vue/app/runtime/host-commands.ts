import { HOST_COMMAND_NAVIGATE_TYPE, LOG_PREFIX } from "./constants";
import { isTypedMessage } from "./typed-message";

interface RouterLike {
	push: (path: string) => unknown;
}

/**
 * The slice of the host's `useDevReload()` composable this module needs:
 * resolve `true` once the committed site layout serves `path`, `false` on
 * timeout.
 */
export interface DevReloadWaiter {
	awaitRoute: (path: string) => Promise<boolean>;
}

/**
 * How many of the host's waits, of 15 s each, a navigation spends on its route. A page the builder
 * writes changes the project's configuration, so the whole project restarts before it serves the
 * page: measured from 10 s to 22 s under `ajs project dev -w`, past one wait. Each wait holds the
 * host's single refresh no longer than its own default, and a known route answers at once.
 */
const ROUTE_WAITS = 4;

/** What navigating the dashboard needs: its router, the host's dev reload, and where it is now. */
export interface NavigationContext {
	router: RouterLike;
	devReload: DevReloadWaiter;
	/** The dashboard's current path: a trip whose page changed meanwhile does not push. */
	location: () => string;
}

/**
 * Sends the dashboard to an in-app path once the host's committed site layout serves it. A page
 * the builder or the agent just wrote is re-registered by a module reload, and a push before the
 * layout lists it lands on a 404. A newer path supersedes the trips still waiting, and so does a
 * page the user opened meanwhile, so the dashboard never moves back to an older target; a page that
 * exists opens at once whatever waits before it. A lapsed or broken wait still navigates, so a page
 * that never comes 404s.
 */
export type Navigator = (path: string) => void;

export interface HostCommandContext {
	navigate: Navigator;
}

interface HostCommandNavigateMessage {
	type: typeof HOST_COMMAND_NAVIGATE_TYPE;
	path: string;
}

type HostCommandMessage = HostCommandNavigateMessage;

/** Takes a sidecar message already parsed; anything that is not a host command is ignored. */
export type HostCommandDispatcher = (msg: unknown) => void;

type HostCommandHandler = (
	msg: HostCommandMessage,
	ctx: HostCommandContext,
) => void;

const IN_APP_PATH = /^\/(?![/\\])/;

/** The page's own route: the site layout lists pages without their query or hash. */
function routeOf(path: string): string {
	return path.split(/[?#]/, 1)[0] ?? path;
}

async function waitForRoute(
	devReload: DevReloadWaiter,
	route: string,
	stillWanted: () => boolean,
): Promise<void> {
	for (let wait = 0; wait < ROUTE_WAITS && stillWanted(); wait += 1) {
		if (await devReload.awaitRoute(route)) return;
	}
}

export function createNavigator(ctx: NavigationContext): Navigator {
	let newest = 0;
	return (path) => {
		newest += 1;
		const trip = newest;
		const from = ctx.location();
		const stillWanted = (): boolean =>
			trip === newest && ctx.location() === from;
		void waitForRoute(ctx.devReload, routeOf(path), stillWanted)
			.catch((err: unknown) => {
				console.error(`${LOG_PREFIX} dev reload wait failed for ${path}`, err);
			})
			.then(() => {
				if (stillWanted()) void ctx.router.push(path);
			});
	};
}

/**
 * Whether the agent may send the dashboard to `path`. What it asks for comes
 * from model output, so it may only ever lead to a page of this origin.
 */
function isInAppPath(path: unknown): path is string {
	if (typeof path !== "string" || !IN_APP_PATH.test(path)) return false;
	try {
		const origin = globalThis.location.origin;
		return new URL(path, origin).origin === origin;
	} catch {
		return false;
	}
}

function handleNavigate(
	msg: HostCommandMessage,
	ctx: HostCommandContext,
): void {
	if (msg.type !== HOST_COMMAND_NAVIGATE_TYPE) return;
	if (!isInAppPath(msg.path)) {
		console.warn(`${LOG_PREFIX} refused to navigate off the dashboard`);
		return;
	}
	ctx.navigate(msg.path);
}

const COMMAND_HANDLERS: Record<string, HostCommandHandler> = {
	[HOST_COMMAND_NAVIGATE_TYPE]: handleNavigate,
};

/** Runs the agent's host commands; its navigations go through `ctx.navigate`, the dashboard's own queue. */
export function createHostCommandDispatcher(
	ctx: HostCommandContext,
): HostCommandDispatcher {
	return (msg: unknown): void => {
		if (!isTypedMessage<HostCommandMessage>(msg)) return;
		const handler = COMMAND_HANDLERS[msg.type];
		if (handler === undefined) {
			console.warn(`${LOG_PREFIX} unknown host command type=${msg.type}`);
			return;
		}
		handler(msg, ctx);
	};
}
