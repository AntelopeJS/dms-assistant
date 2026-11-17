/** A chat's token use as the panel shows it. */
export interface TokenTally {
	/** Input, cache writes and output: the tokens the chat added. */
	newTokens: number;
	/** Context read back from the prompt cache, once per request. */
	cacheReadTokens: number;
}

/**
 * The tally of a sidecar total, which counts cache reads among its input. A
 * sidecar that reports no cache reads leaves the whole total as new.
 */
export function tokenTally(
	totalTokens: number,
	cacheReadTokens = 0,
): TokenTally {
	return {
		newTokens: Math.max(0, totalTokens - cacheReadTokens),
		cacheReadTokens,
	};
}
