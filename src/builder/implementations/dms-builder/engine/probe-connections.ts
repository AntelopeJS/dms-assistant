type Closer = () => Promise<void>;

async function closeQuietly(close: Closer): Promise<void> {
  try {
    await close();
  } catch {
    return;
  }
}

/**
 * What a probe has opened, which the check closes once the probe has answered and when its
 * deadline passes, whatever the probe is waiting for. A probe registers each client as it opens
 * it, so no socket outlives the answer because a client library bounds only its connecting.
 */
export class ProbeConnections {
  private closers: Closer[] = [];
  private closed = false;

  /** Registers `close`; it is called at once when the check has closed its connections already. */
  add(close: Closer): void {
    if (this.closed) {
      void closeQuietly(close);
      return;
    }
    this.closers.push(close);
  }

  /** Calls each registered closer once, and settles when all have; a closer that fails is ignored. */
  async closeAll(): Promise<void> {
    this.closed = true;
    await Promise.all(this.closers.splice(0).map(closeQuietly));
  }
}
