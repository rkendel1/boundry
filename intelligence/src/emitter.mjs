/**
 * The product side of ingestion: how a Boundry product reports events without making Boundry's availability part
 * of its own.
 *
 * - `emit(event)` is synchronous, never throws, and never waits on the network. A product's request path calls it and
 *   moves on.
 * - Events are validated locally (an invalid event is dropped and counted, not sent), queued in bounded memory, and
 *   sent in batches in the background.
 * - Network failures, timeouts, 429 and 5xx keep the batch queued and back off; ingestion's idempotent event ids make
 *   every resend safe. Per-event `rejected` and `conflict` answers are dropped and counted (resending cannot help).
 * - When the queue is full, the oldest events are dropped and counted. Memory never grows without bound.
 *
 * Nothing is persisted locally: events queued when a process exits are lost (counted in `stats().pending`), by design.
 */
import { LIMITS, validateEvent } from './contract.mjs';

export function createEventEmitter({ endpoint, key, fetch: fetchImpl = globalThis.fetch, maxQueue = 1000, batchSize = 100, flushIntervalMs = 5000, timeoutMs = 3000, maxBackoffMs = 300_000, onError = () => undefined } = {}) {
  if (typeof endpoint !== 'string' || typeof key !== 'string') throw new TypeError('endpoint and key are required');
  const queue = [];
  const stats = { emitted: 0, invalid: 0, dropped: 0, accepted: 0, duplicate: 0, rejected: 0, conflict: 0, failedAttempts: 0 };
  let backoffMs = 0;
  let nextAttempt = 0;
  let flushing = null;
  let closed = false;
  const timer = setInterval(() => void flush(), flushIntervalMs);
  timer.unref?.();

  function emit(event) {
    try {
      if (closed) return false;
      const checked = validateEvent(event);
      if (!checked.ok) {
        stats.invalid += 1;
        return false;
      }
      queue.push(JSON.parse(JSON.stringify(event)));
      stats.emitted += 1;
      while (queue.length > maxQueue) {
        queue.shift();
        stats.dropped += 1;
      }
      if (queue.length >= batchSize) void flush();
      return true;
    } catch (error) {
      safe(() => onError(error));
      return false;
    }
  }

  /** Sends what is queued. Never rejects. Resolves with what happened. */
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      try {
        while (queue.length && Date.now() >= nextAttempt) {
          const batch = queue.slice(0, Math.min(batchSize, LIMITS.batch));
          let response;
          try {
            response = await fetchImpl(endpoint, {
              method: 'POST',
              headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
              body: JSON.stringify({ events: batch }),
              signal: AbortSignal.timeout(timeoutMs),
            });
          } catch (error) {
            return retryLater(error);
          }
          if (response.status === 429 || response.status >= 500) {
            const body = await response.json().catch(() => ({}));
            return retryLater(new Error(`ingestion answered ${response.status}`), body?.error?.details?.retryAfterSeconds);
          }
          if (!response.ok) {
            // 400/401/403/413: the batch as a whole cannot be accepted by retrying it. Drop and count.
            queue.splice(0, batch.length);
            stats.rejected += batch.length;
            safe(() => onError(new Error(`ingestion refused a batch: ${response.status}`)));
            continue;
          }
          const ack = await response.json().catch(() => null);
          queue.splice(0, batch.length);
          backoffMs = 0;
          for (const result of ack?.results ?? []) if (result.status in stats) stats[result.status] += 1;
        }
      } catch (error) {
        safe(() => onError(error));
      } finally {
        flushing = null;
      }
      return { pending: queue.length };
    })();
    return flushing;
  }

  function retryLater(error, retryAfterSeconds) {
    stats.failedAttempts += 1;
    backoffMs = Math.min(maxBackoffMs, backoffMs ? backoffMs * 2 : 1000);
    nextAttempt = Date.now() + Math.max(backoffMs, (retryAfterSeconds ?? 0) * 1000);
    safe(() => onError(error));
    return { pending: queue.length };
  }

  async function close() {
    closed = true;
    clearInterval(timer);
    nextAttempt = 0;
    await flush();
    return { pending: queue.length };
  }

  return { emit, flush, close, stats: () => ({ ...stats, pending: queue.length }) };
}

function safe(fn) {
  try {
    fn();
  } catch {
    // A failing error callback must not affect the product either.
  }
}
