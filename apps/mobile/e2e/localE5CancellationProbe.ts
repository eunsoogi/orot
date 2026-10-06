import { localE5NativeBackend } from '../src/rag/localE5NativeBackend';

/** Measures native cancellation response separately from the ORT actor draining. */
export async function cancelOneInFlightBatch(): Promise<{
  outcome: 'cancelled' | 'completed-before-cancel';
  responseMilliseconds: number;
  settlementMilliseconds: number;
}> {
  const requestId = 'local-e5-simulator-cancellation';
  const longText = '혈압과 복용 기록을 확인합니다. '.repeat(120);
  const pending = localE5NativeBackend.embedBatch(
    Array.from({ length: 8 }, () => longText),
    'query',
    requestId,
  );
  await new Promise(resolve => setTimeout(resolve, 30));
  const start = Date.now();
  localE5NativeBackend.cancel(requestId);
  let outcome: 'cancelled' | 'completed-before-cancel';
  try {
    await pending;
    outcome = 'completed-before-cancel';
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code !== 'LOCAL_EMBEDDING_CANCELLED') throw error;
    outcome = 'cancelled';
  }
  const responseMilliseconds = Date.now() - start;

  // ORT inference is synchronous on its actor, so this queued no-op measures when that batch has drained.
  await localE5NativeBackend.prepare(
    'local-e5-cancellation-settle',
    () => undefined,
  );
  return {
    outcome,
    responseMilliseconds,
    settlementMilliseconds: Date.now() - start,
  };
}
