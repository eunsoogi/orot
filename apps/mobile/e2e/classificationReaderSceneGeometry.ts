type Receipt = Record<string, unknown>;
export type ReaderSceneOutcome =
  'armed' | 'requested' | 'settled' | 'denied' | 'owner-mismatch' | 'unsettled';
const record = (value: unknown): Receipt =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Receipt)
    : {};
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

/** Interpret only the existing native probe's session/owner/actual-event contract; never synthesize geometry. */
export function readerSceneOutcome(
  armed: Receipt,
  value: unknown,
): ReaderSceneOutcome {
  const receipt = record(value);
  if (
    receipt.status !== 'sampled' ||
    Object.keys(record(receipt.error)).length ||
    !receipt.error ||
    typeof receipt.error !== 'object' ||
    Array.isArray(receipt.error)
  )
    return 'denied';
  if (
    receipt.session !== armed.session ||
    receipt.sceneID !== armed.sceneID ||
    receipt.windowID !== armed.windowID ||
    receipt.generation !== armed.generation ||
    receipt.candidateWindowCount !== 1
  )
    return 'owner-mismatch';
  const bounds = record(receipt.windowBounds);
  const current = record(receipt.current);
  if (
    !finite(receipt.requestCount) ||
    receipt.requestCount < 0 ||
    receipt.requestCount > 1 ||
    !finite(bounds.width) ||
    !finite(bounds.height) ||
    bounds.width <= bounds.height ||
    ![3, 4].includes(current.sceneOrientation as number) ||
    !Array.isArray(receipt.events)
  )
    return 'unsettled';
  const observed = receipt.events.some(candidate => {
    const event = record(candidate);
    return (
      event.sceneID === armed.sceneID &&
      event.windowID === armed.windowID &&
      event.sceneOrientation === current.sceneOrientation &&
      ['completed', 'unavailable'].includes(event.transition as string) &&
      event.cancelled !== true &&
      finite(event.atMs) &&
      finite(receipt.startedAtMs) &&
      finite(receipt.sampledAtMs) &&
      receipt.startedAtMs === armed.startedAtMs &&
      finite(armed.sampledAtMs) &&
      receipt.sampledAtMs >= armed.sampledAtMs &&
      event.atMs >= receipt.startedAtMs &&
      event.atMs <= receipt.sampledAtMs &&
      finite(event.width) &&
      finite(event.height) &&
      Math.abs(event.width - (bounds.width as number)) <= 0.5 &&
      Math.abs(event.height - (bounds.height as number)) <= 0.5
    );
  });
  return observed ? 'settled' : 'unsettled';
}

/** Exactly three explicit commands, one request maximum, no retries or change to native orientation policy. */
export function createReaderSceneAdapter(
  session: unknown,
  command: (session: string, mode: string) => Promise<unknown>,
) {
  let step = 0;
  let pending = false;
  let disposed = false;
  let armed: Receipt = {};
  return {
    dispose: () => {
      disposed = true;
    },
    run: async () => {
      if (disposed || pending || step >= 3 || !uuid(session)) return null;
      pending = true;
      const mode = ['start', 'request', 'read'][step++];
      try {
        const receipt = record(await command(session, mode));
        if (disposed) return null;
        let outcome: ReaderSceneOutcome = 'denied';
        const valid =
          receipt.status === 'sampled' &&
          finite(receipt.startedAtMs) &&
          finite(receipt.sampledAtMs) &&
          receipt.sampledAtMs >= receipt.startedAtMs &&
          (mode === 'start' ||
            (receipt.startedAtMs === armed.startedAtMs &&
              finite(armed.sampledAtMs) &&
              receipt.sampledAtMs >= armed.sampledAtMs)) &&
          receipt.session === session &&
          receipt.mode === mode &&
          receipt.candidateWindowCount === 1 &&
          uuid(receipt.sceneID) &&
          uuid(receipt.windowID) &&
          finite(receipt.generation) &&
          Number.isInteger(receipt.generation) &&
          receipt.generation > 0 &&
          finite(receipt.requestCount) &&
          receipt.requestCount >= 0 &&
          receipt.requestCount <= 1 &&
          receipt.error !== null &&
          !Array.isArray(receipt.error) &&
          typeof receipt.error === 'object' &&
          Object.keys(record(receipt.error)).length === 0;
        if (
          valid &&
          mode === 'start' &&
          receipt.requestCount === 0 &&
          record(receipt.before).sceneOrientation === 1
        ) {
          armed = receipt;
          outcome = 'armed';
        } else if (valid && mode !== 'start') {
          outcome = readerSceneOutcome(armed, receipt);
          if (mode === 'request' && outcome === 'unsettled')
            outcome = 'requested';
          else if (mode === 'request' && outcome === 'settled')
            outcome = 'requested';
        }
        if (
          outcome === 'denied' ||
          outcome === 'owner-mismatch' ||
          (mode === 'start' && outcome !== 'armed')
        )
          step = 3;
        return {
          outcome,
          receipt,
          next: step < 3 ? ['start', 'request', 'read'][step] : null,
        };
      } catch {
        step = 3;
        return disposed
          ? null
          : {
              outcome: 'denied' as const,
              receipt: { status: 'unavailable', session, mode },
              next: null,
            };
      } finally {
        pending = false;
      }
    },
  };
}
