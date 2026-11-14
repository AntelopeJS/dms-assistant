import type { StopGraces } from "../../src/providers/codex/stop.js";

/**
 * The real graces only matter against a wedged app-server in the field; the
 * cases that outwait them in tests would otherwise sit through seconds each.
 */
export const TEST_STOP_GRACES: StopGraces = { terminateMs: 300, killMs: 300 };

const probe = process.kill.bind(process);

/**
 * Whether a pid is still taken. Signal 0 only asks the question, on Windows as
 * on every POSIX host, where /proc would limit it to Linux. It goes through
 * the original `process.kill`, so a test that stubs `process.kill` still sees
 * the real answer.
 */
export function isRunning(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    probe(pid, 0);
    return true;
  } catch {
    return false;
  }
}
