const { request } = require("node:http");

/**
 * The port a sidecar prints once it listens; rejects when the process exits
 * first, with what it printed.
 *
 * @param {import("node:child_process").ChildProcessByStdio<null, import("node:stream").Readable, import("node:stream").Readable>} child
 * @returns {Promise<number>}
 */
function waitForPort(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    /** @param {Buffer} chunk */
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/DMS_ASSISTANT_SIDECAR_PORT=(\d+)/);
      if (match) resolve(Number(match[1]));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      reject(new Error(`sidecar exited with code ${code}: ${output}`));
    });
  });
}

/**
 * The sidecar's `/health` answer on `port`.
 *
 * @param {number} port
 * @returns {Promise<{ statusCode: number | undefined; body: string }>}
 */
function requestHealth(port) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/health" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Stops `child` and resolves once it has exited; at once when it already has.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @returns {Promise<void>}
 */
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}

module.exports = { requestHealth, stopChild, waitForPort };
