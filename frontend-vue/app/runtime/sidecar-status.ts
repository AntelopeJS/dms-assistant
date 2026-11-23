import { type Ref, readonly, ref, watch } from "vue";
import { createBackoff, nextDelay, resetBackoff } from "./backoff";
import {
	SIDECAR_POLL_DELAYS_MS,
	SIDECAR_STATUS_CONNECTED,
	SIDECAR_STATUS_CONNECTING,
	SIDECAR_STATUS_REVIVING,
	SIDECAR_STATUS_UNAVAILABLE,
} from "./constants";

export type SidecarStatus =
	| typeof SIDECAR_STATUS_CONNECTING
	| typeof SIDECAR_STATUS_CONNECTED
	| typeof SIDECAR_STATUS_REVIVING
	| typeof SIDECAR_STATUS_UNAVAILABLE;

interface SidecarInfo {
	isRunning: boolean;
	hasGivenUp: boolean;
	disabled: boolean;
}

export interface SidecarStatusController {
	/**
	 * Runs the first probe. Returns false when the assistant should not be shown
	 * at all — the dms-assistant backend route is absent (probe unreachable) or
	 * spawning is disabled for this process — so the caller skips injection
	 * entirely.
	 */
	init: () => Promise<boolean>;
	getStatus: () => SidecarStatus;
	/**
	 * Subscribes to status changes; fires immediately with the current status so
	 * a late subscriber (the panel or launcher registered after init) reflects it
	 * right away.
	 */
	subscribe: (cb: (status: SidecarStatus) => void) => () => void;
	/**
	 * The host channel dropped: re-probe now, which also revives an idle-exited
	 * sidecar. The status turns `reviving` only when the probe finds the sidecar
	 * down, since leaving `reviving` makes the tab replace its stream at once.
	 */
	reportChannelDown: () => void;
	/** Probes again from scratch, even after giving up: a restart was asked. */
	retry: () => void;
	dispose: () => void;
}

/**
 * The read of the sidecar's info the controller follows: `useApiData` in the
 * dashboard, opened with `immediate: false` and polled every `interval`.
 */
/** The backend's sidecar info, as far as the tab reads it. */
export type SidecarInfoPayload = Partial<SidecarInfo>;

export interface SidecarInfoRead {
	data: Readonly<Ref<SidecarInfoPayload | null>>;
	error: Readonly<Ref<unknown>>;
	pending: Readonly<Ref<boolean>>;
	/** The first read. */
	execute: () => Promise<void>;
	/** Reads the info again now. */
	refresh: () => Promise<void>;
}

/**
 * Opens the info read, polled every `interval` ms while it is above 0: the
 * controller raises it while the sidecar comes back, and sets it to 0 once
 * the sidecar answers or gives up.
 */
export type OpenSidecarInfoRead = (
	interval: Readonly<Ref<number>>,
) => SidecarInfoRead;

/** The info of the read's last answer, or null when it failed. */
function readInfo(read: SidecarInfoRead): SidecarInfo | null {
	const body = read.data.value;
	if (read.error.value || !body) return null;
	return {
		isRunning: body.isRunning === true,
		hasGivenUp: body.hasGivenUp === true,
		disabled: body.disabled === true,
	};
}

/**
 * Follows the sidecar's info read: each answer, a probe's or the polling's,
 * moves the status. An answer of `null` means the probe itself failed (backend
 * momentarily unreachable), and a sidecar that is down but has not given up is
 * not terminal either: the probe already asked the backend to respawn, so the
 * controller keeps polling until the sidecar runs.
 */
export function createSidecarStatusController(
	openRead: OpenSidecarInfoRead,
): SidecarStatusController {
	const backoff = createBackoff();
	const subscribers = new Set<(status: SidecarStatus) => void>();
	const pollInterval = ref(0);
	let status: SidecarStatus = SIDECAR_STATUS_CONNECTING;
	let disposed = false;
	const read = openRead(readonly(pollInterval));

	function notify(): void {
		for (const cb of subscribers) cb(status);
	}

	function setStatus(next: SidecarStatus): void {
		if (status === next) return;
		status = next;
		notify();
	}

	function keepPolling(): void {
		pollInterval.value = nextDelay(backoff, SIDECAR_POLL_DELAYS_MS);
	}

	function handleInfo(info: SidecarInfo | null): void {
		if (disposed) return;
		if (info === null) {
			setStatus(SIDECAR_STATUS_REVIVING);
			keepPolling();
			return;
		}
		if (info.hasGivenUp) {
			pollInterval.value = 0;
			setStatus(SIDECAR_STATUS_UNAVAILABLE);
			return;
		}
		if (info.isRunning) {
			resetBackoff(backoff);
			pollInterval.value = 0;
			setStatus(SIDECAR_STATUS_CONNECTED);
			return;
		}
		setStatus(SIDECAR_STATUS_REVIVING);
		keepPolling();
	}

	const stopFollowing = watch(
		read.pending,
		(isPending, wasPending) => {
			if (wasPending && !isPending) handleInfo(readInfo(read));
		},
		{ flush: "sync" },
	);

	function dispose(): void {
		disposed = true;
		pollInterval.value = 0;
		stopFollowing();
		subscribers.clear();
	}

	function probeAgain(): void {
		if (disposed) return;
		resetBackoff(backoff);
		setStatus(SIDECAR_STATUS_REVIVING);
		void read.refresh();
	}

	return {
		init: async (): Promise<boolean> => {
			await read.execute();
			const info = readInfo(read);
			if (info !== null && !info.disabled) return true;
			dispose();
			return false;
		},
		getStatus: () => status,
		subscribe: (cb) => {
			subscribers.add(cb);
			cb(status);
			return () => {
				subscribers.delete(cb);
			};
		},
		reportChannelDown: () => {
			if (status !== SIDECAR_STATUS_CONNECTED || disposed) return;
			resetBackoff(backoff);
			void read.refresh();
		},
		retry: probeAgain,
		dispose,
	};
}
