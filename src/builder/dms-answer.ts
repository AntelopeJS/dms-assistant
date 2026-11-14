/** A call to a builder operation while its builder is off waits for a provider that never attaches. */
export const DMS_ANSWER_TIMEOUT_MS = 10_000;

export function withinDmsTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `@antelopejs/dms did not answer within ${DMS_ANSWER_TIMEOUT_MS / 1000} s`,
          ),
        ),
      DMS_ANSWER_TIMEOUT_MS,
    );
    timer.unref();
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}
