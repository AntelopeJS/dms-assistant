const VERDICT =
  /^\[dms-assistant\] ([^"]+?: (?:nothing left to move, safe to remove|not safe to remove, |.+ still here, move them before removing).*)$/;

/**
 * @typedef {"info" | "warn"} Level
 * @typedef {{ level: Level, line: string }} Logged
 */

/** What the move logs: its per-entry verdicts, and its other notices and warnings. */
function moveLog() {
  /** @type {Logged[]} */
  const logged = [];
  /** @param {Level} level */
  const record =
    (level) =>
    /** @param {unknown[]} args */
    (...args) => {
      logged.push({ level, line: args.map(String).join(" ") });
    };
  /** @param {Level} level */
  const others = (level) =>
    logged
      .filter((entry) => entry.level === level && !VERDICT.test(entry.line))
      .map(({ line }) => line);
  return {
    Logging: { Info: record("info"), Warn: record("warn") },
    notices: () => others("info"),
    warnings: () => others("warn"),
    /** @returns {Logged[]} Each per-entry line, without the log prefix, in the order logged. */
    verdicts: () =>
      logged.flatMap(({ level, line }) => {
        const verdict = VERDICT.exec(line)?.[1];
        return verdict === undefined ? [] : [{ level, line: verdict }];
      }),
  };
}

module.exports = { moveLog };
