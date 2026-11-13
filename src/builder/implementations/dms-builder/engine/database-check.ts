import {
  type DatabaseAccess,
  type DatabaseEngine,
  failureMessage,
  noAnswerReason,
  type Probe,
  unanswered,
} from "./database-access";
import { ProbeConnections } from "./probe-connections";
import { probeMongodb } from "./probe-mongodb";
import { probePostgres } from "./probe-postgres";
import { probeRethinkdb } from "./probe-rethinkdb";

/** How long a probe waits for a server to connect, and for each answer. */
export const CONNECT_TIMEOUT_MS = 5000;

/** The whole check ends within this many connect timeouts, whatever a client does. */
const DEADLINE_IN_TIMEOUTS = 3;
const TOO_SLOW = "The database did not answer in time.";

const PROBES: Record<DatabaseEngine, Probe> = {
  postgres: probePostgres,
  mongodb: probeMongodb,
  rethinkdb: probeRethinkdb,
};

/**
 * Tests a customer's database live: whether a server answers at `url`, who it signs in, and
 * whether that account can read and write. The driver module of the engine is not configured
 * when this runs, so the check opens the database itself with the engine's client library. It
 * writes nothing to the project and answers, never rejects. Every connection the probe opened is
 * closed when it answers, and when the deadline passes without waiting for them: no socket
 * outlives the answer, whatever the server is doing.
 */
export async function checkDatabase(
  engine: DatabaseEngine,
  url: string,
  timeoutMs: number = CONNECT_TIMEOUT_MS,
): Promise<DatabaseAccess> {
  const connections = new ProbeConnections();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<DatabaseAccess>((resolve) => {
    timer = setTimeout(() => {
      void connections.closeAll();
      resolve(unanswered(TOO_SLOW));
    }, timeoutMs * DEADLINE_IN_TIMEOUTS);
  });
  try {
    return await Promise.race([
      PROBES[engine](url, timeoutMs, connections)
        .catch((error: unknown) =>
          unanswered(noAnswerReason(failureMessage(error), url)),
        )
        .finally(() => connections.closeAll()),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
