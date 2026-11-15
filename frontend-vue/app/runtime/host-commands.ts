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

/** What navigating the dashboard needs: its router, and the host's dev reload to wait on. */
export interface NavigationContext {
	router: RouterLike;
	devReload: DevReloadWaiter;
}

/**
 * Sends the dashboard to an in-app path once the host's committed site layout serves it. A page
 * the builder or the agent just wrote is re-registered by a module reload, and a push before the
 * layout lists it lands on a 404. Trips run one at a time, and a burst collapses into one trip to
 * the newest path. A lapsed or broken wait still navigates, so a page that never comes 404s.
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

/**
 * Trips run one at a time on `tail`. `nextPath` holds the newest target still waiting for a slot,
 * so a burst collapses into a single trip to the latest path instead of landing on the oldest one.
 */
interface NavigatorState {
	ctx: NavigationContext;
	tail: Promise<void>;
	nextPath: string | null;
}

type HostCommandHandler = (
	msg: HostCommandMessage,
	ctx: HostCommandContext,
) => void;

const IN_APP_PATH = /^\/(?![/\\])/;

/** The page's own route: the site layout lists pages without their query or hash. */
function routeOf(path: string): string {
	return path.split(/[?#]/, 1)[0] ?? path;
}

async function awaitRouteThenPush(
	path: string,
	ctx: NavigationContext,
): Promise<void> {
	try {
		await ctx.devReload.awaitRoute(routeOf(path));
	} catch (err: unknown) {
		console.error(`${LOG_PREFIX} dev reload wait failed for ${path}`, err);
	}
	void ctx.router.push(path);
}

async function runNavigate(state: NavigatorState): Promise<void> {
	const path = state.nextPath;
	if (path === null) return;
	state.nextPath = null;
	await awaitRouteThenPush(path, state.ctx);
}

export function createNavigator(ctx: NavigationContext): Navigator {
	const state: NavigatorState = {
		ctx,
		tail: Promise.resolve(),
		nextPath: null,
	};
	return (path) => {
		state.nextPath = path;
		state.tail = state.tail
			.then(() => runNavigate(state))
			.catch((err: unknown) => {
				console.error(`${LOG_PREFIX} host command failed`, err);
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
