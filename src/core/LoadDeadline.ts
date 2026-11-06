/** A cancelled or stalled preparation must not leave a loading view forever. */
export async function withLoadDeadline<T>(work: Promise<T>, signal: AbortSignal, timeoutMs = 180000): Promise<T> {
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(new Error('Resource preparation timed out.')), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
