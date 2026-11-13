import { execFile, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);
const PORT_MAPPING = /:(\d+)\s*$/;
const RANDOM_BYTES = 4;
const POLL_MS = 300;
const READY_TIMEOUT_MS = 90_000;

/** Whether a Docker daemon answers: the live checks run the engines' own images. */
export const dockerAvailable =
  spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    stdio: "ignore",
  }).status === 0;

/** What a title says when the live checks cannot run, so a skipped suite names its reason. */
export const LIVE_SUITE_NOTE = dockerAvailable
  ? ""
  : " (skipped: no Docker daemon answers)";

/** How long a hook may take to start an image and for its server to answer. */
export const START_TIMEOUT_MS = 180_000;

/** A running database server and the local port it answers on. */
export interface Container {
  name: string;
  port: number;
}

/** Starts `image` with its `containerPort` published on a free local port. */
export async function startContainer(
  image: string,
  containerPort: number,
  runArguments: string[] = [],
  command: string[] = [],
): Promise<Container> {
  const name = `dms-assistant-check-${process.pid}-${randomBytes(RANDOM_BYTES).toString("hex")}`;
  await run("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-p",
    `127.0.0.1::${containerPort}`,
    ...runArguments,
    image,
    ...command,
  ]);
  const { stdout } = await run("docker", [
    "port",
    name,
    `${containerPort}/tcp`,
  ]);
  const port = Number(PORT_MAPPING.exec(stdout.split("\n")[0] ?? "")?.[1]);
  return { name, port };
}

/** Stops and removes a server, whatever state it is in. */
export async function removeContainer(
  container: Container | undefined,
): Promise<void> {
  if (container) {
    await run("docker", ["rm", "-f", container.name]).catch(() => undefined);
  }
}

/** Polls `ready` until it answers `true`; it must catch what a server still starting throws. */
export async function waitFor(
  what: string,
  ready: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await ready()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`${what} did not answer within ${READY_TIMEOUT_MS} ms`);
}

const TcpAddress = z.object({ port: z.number() });

function portOf(server: net.Server): number {
  return TcpAddress.parse(server.address()).port;
}

/** A local port nothing listens on. */
export async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = portOf(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A server that accepts connections and never says a word, as a host behind a dropped packet does. */
export async function silentServer(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: portOf(server),
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const RUN_SECRET = randomBytes(6).toString("hex");

/** A throwaway secret for `name`, random for each test run, so no credential sits in the source. */
export function secretOf(name: string): string {
  return `${name}-${RUN_SECRET}`;
}
