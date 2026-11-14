type Locks = Pick<LockManager, "request">;

/**
 * Which follow of a connection starts and answers its analysis: one follow at a time across the
 * tabs of the browser, so a tab duplicated while a connection loads, which copies the remembered
 * connection, follows the same analysis without a second request. The lead is a Web Lock, which a
 * closed tab releases. Outside a secure context the browser has no Web Locks, and every follow leads.
 */
export interface AnalysisLead {
	/** Whether this follow leads the analysis of `connection`; it keeps the lead until `release`. */
	take: (connection: string) => Promise<boolean>;
	release: () => void;
}

export function analysisLead(locks: Locks | undefined): AnalysisLead {
	let held: { connection: string; release: () => void } | undefined;

	function release(): void {
		held?.release();
		held = undefined;
	}

	function take(connection: string): Promise<boolean> {
		if (locks === undefined || held?.connection === connection) {
			return Promise.resolve(true);
		}
		release();
		return new Promise((resolve) => {
			void locks.request(
				`dms-assistant:analysis:${connection}`,
				{ ifAvailable: true },
				(lock) => {
					if (lock === null) {
						resolve(false);
						return undefined;
					}
					return new Promise<void>((done) => {
						held = { connection, release: done };
						resolve(true);
					});
				},
			);
		});
	}

	return { take, release };
}

/** The lead over the tab's Web Locks, when the browser offers them. */
export function tabAnalysisLead(): AnalysisLead {
	return analysisLead(
		typeof navigator === "undefined" ? undefined : navigator.locks,
	);
}
