const { test } = require("node:test");

const WINDOWS = process.platform === "win32";

/**
 * Declares a test of POSIX permission bits. Windows has none: `stat` reports
 * 0o666 there after `chmod(0o600)`, so the test is skipped on Windows.
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
function posixModeTest(name, fn) {
  const skip = WINDOWS && "Windows has no POSIX permission bits";
  return test(name, { skip }, fn);
}

/**
 * Declares a test that sends a signal to a process group. Windows has no
 * process groups, and `process.kill` there ends a process without running its
 * signal handlers, so the test is skipped on Windows.
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
function processGroupTest(name, fn) {
  const skip = WINDOWS && "Windows has no process groups to signal";
  return test(name, { skip }, fn);
}

module.exports = { posixModeTest, processGroupTest };
