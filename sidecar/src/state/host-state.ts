import { UNKNOWN_PAGE_PATH } from "../constants/host-state.js";
import type { PageFilepathResolver } from "../pages/page-filepath.js";

export interface CurrentPage {
  path: string;
  filepath?: string;
  title?: string;
}

/** What the browser reports about the page it displays. */
interface ReportedPage {
  path: string;
  title?: string;
}

/**
 * The page each person's dashboard shows, keyed by the `userId` of the
 * connection's actor (null: a connection that named no actor). A turn reads
 * its conversation owner's page, never another person's.
 */
export interface HostState {
  getCurrentPage(viewerId: string | null): CurrentPage;
  setCurrentPage(viewerId: string | null, page: ReportedPage): Promise<void>;
}

/** Options of {@link createHostState}. */
export interface HostStateOptions {
  resolveFilepath?: PageFilepathResolver;
}

function buildUnknownPage(): CurrentPage {
  return { path: UNKNOWN_PAGE_PATH };
}

function withFilepath(
  page: CurrentPage,
  filepath: string | undefined,
): CurrentPage {
  return filepath === undefined ? page : { ...page, filepath };
}

/**
 * Holds the page each person's host displays. The browser reports its route
 * and title; the source file is resolved here from the route, and only applied
 * while that report is still the person's latest one.
 */
export function createHostState(options: HostStateOptions = {}): HostState {
  const pages = new Map<string | null, CurrentPage>();
  return {
    getCurrentPage: (viewerId) => pages.get(viewerId) ?? buildUnknownPage(),
    setCurrentPage: async (viewerId, page) => {
      const reported: CurrentPage = { ...page };
      pages.set(viewerId, reported);
      if (options.resolveFilepath === undefined) return;
      const filepath = await options.resolveFilepath(page.path);
      if (pages.get(viewerId) !== reported) return;
      pages.set(viewerId, withFilepath(reported, filepath));
    },
  };
}
