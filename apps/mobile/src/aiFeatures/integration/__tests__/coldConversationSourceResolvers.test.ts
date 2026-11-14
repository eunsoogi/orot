import { waitFor } from '@testing-library/react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createColdConversationSourceResolvers } from '../coldConversationSourceResolvers';
const owner = {
  sessionId: 'session',
  sessionVersion: 0,
  requestId: 'request',
  operationRunId: 'run',
};
const signal = () => new AbortController().signal;
function source(id: string) {
  const registry = new LocalEvidenceReferenceRegistry();
  const original: EvidenceReference = {
    sourceKind: 'personal_record',
    sourceId: id,
    sourceRevision: 'v1',
    evidenceId: id,
    evidenceRevision: 'v1',
    locator: { kind: 'record', id },
    effectiveTime: null,
    reviewState: 'reviewed',
  };
  const validate = jest.fn(async () => true);
  const readSource = jest.fn(async () => ({
    status: 'available' as const,
    document: { sourceKind: 'personal_record' as const, records: [] },
  }));
  const alias = registry.add({
    reference: original,
    content: '',
    validate,
    readSource,
  });
  return { registry, alias, original, validate, readSource };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('identical alias tokens route only to their exact request owner, with no global fallback', async () => {
  const routing = createColdConversationSourceResolvers();
  const first = source('synthetic-first'),
    second = source('synthetic-second');
  expect(first.alias.evidenceId).toBe(second.alias.evidenceId);
  const other = { ...owner, requestId: 'other', operationRunId: 'other-run' };
  const isCurrent = jest.fn(async () => true);
  routing.register({ owner, registry: first.registry, isCurrent });
  routing.register({ owner: other, registry: second.registry, isCurrent });
  await expect(
    routing.resolveSource(owner, first.alias, signal()),
  ).resolves.toEqual(first.original);
  await expect(
    routing.resolveSource(other, first.alias, signal()),
  ).resolves.toEqual(second.original);
  await expect(
    routing.resolveSource(
      { ...owner, sessionVersion: 1 },
      first.alias,
      signal(),
    ),
  ).resolves.toBeUndefined();
  await expect(
    routing.readSource(
      { ...owner, requestId: 'absent' },
      first.alias,
      signal(),
    ),
  ).resolves.toEqual({ status: 'unavailable' });
  expect(isCurrent).toHaveBeenCalledTimes(4);
});

test.each(['replace', 'invalidate', 'abort', 'freshness'] as const)(
  'a delayed source read cannot escape %s fencing',
  async action => {
    const routing = createColdConversationSourceResolvers();
    const first = source('synthetic-first'),
      second = source('synthetic-second');
    const pending = deferred<Awaited<ReturnType<typeof first.readSource>>>();
    first.readSource.mockImplementationOnce(() => pending.promise);
    const isCurrent = jest.fn(async () => true);
    const cleanup = routing.register({
      owner,
      registry: first.registry,
      isCurrent,
    });
    const controller = new AbortController();
    const read = routing.readSource(owner, first.alias, controller.signal);
    await waitFor(() => expect(first.readSource).toHaveBeenCalledTimes(1));
    if (action === 'replace') {
      routing.register({
        owner,
        registry: second.registry,
        isCurrent: async () => true,
      });
      cleanup();
    }
    if (action === 'invalidate')
      routing.invalidateRequest(owner.sessionId, owner.requestId);
    if (action === 'abort') controller.abort();
    if (action === 'freshness') isCurrent.mockResolvedValue(false);
    pending.resolve({
      status: 'available',
      document: { sourceKind: 'personal_record', records: [] },
    });
    await expect(read).resolves.toEqual({ status: 'unavailable' });
    if (action === 'replace')
      await expect(
        routing.resolveSource(owner, second.alias, signal()),
      ).resolves.toEqual(second.original);
  },
);

test('a delayed ownership check cannot read after replacement, and input owner mutation cannot redirect it', async () => {
  const routing = createColdConversationSourceResolvers();
  const first = source('first'),
    second = source('second');
  const pending = deferred<boolean>();
  const mutableOwner = { ...owner };
  const check = jest.fn<Promise<boolean>, [typeof owner, AbortSignal]>(
    () => pending.promise,
  );
  routing.register({
    owner: mutableOwner,
    registry: first.registry,
    isCurrent: check,
  });
  mutableOwner.requestId = 'changed';
  const read = routing.readSource(owner, first.alias, signal());
  await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  expect(check.mock.calls[0][0]).toEqual(owner);
  routing.register({
    owner,
    registry: second.registry,
    isCurrent: async () => true,
  });
  pending.resolve(true);
  await expect(read).resolves.toEqual({ status: 'unavailable' });
  expect(first.readSource).not.toHaveBeenCalled();
});

test('session invalidation, source revision failures and cancellation are fail-closed', async () => {
  const routing = createColdConversationSourceResolvers(),
    f = source('synthetic');
  routing.register({
    owner,
    registry: f.registry,
    isCurrent: async () => true,
  });
  f.validate.mockResolvedValue(false);
  await expect(
    routing.resolveSource(owner, f.alias, signal()),
  ).resolves.toBeUndefined();
  f.validate.mockResolvedValue(true);
  const controller = new AbortController();
  controller.abort();
  await expect(
    routing.readSource(owner, f.alias, controller.signal),
  ).resolves.toEqual({ status: 'unavailable' });
  expect(f.readSource).not.toHaveBeenCalled();
  routing.invalidateSession(owner.sessionId);
  await expect(routing.readSource(owner, f.alias, signal())).resolves.toEqual({
    status: 'unavailable',
  });
});

test('tool routes require matching run and persisted call/source checks before and after reading', async () => {
  const routing = createColdConversationSourceResolvers(),
    f = source('synthetic');
  const call = {
    sessionId: owner.sessionId,
    operationRunId: owner.operationRunId,
    callId: 'tool-1',
  };
  routing.register({
    owner,
    registry: f.registry,
    isCurrent: async () => true,
  });
  await expect(
    routing.resolveToolSource(owner, f.alias, signal(), call),
  ).resolves.toBeUndefined();
  expect(f.readSource).not.toHaveBeenCalled();
  const verify = jest.fn(async () => true);
  routing.register({
    owner,
    registry: f.registry,
    isCurrent: async () => true,
    toolSourceIsCurrent: verify,
  });
  await expect(
    routing.resolveToolSource(owner, f.alias, signal(), {
      ...call,
      operationRunId: 'foreign',
    }),
  ).resolves.toBeUndefined();
  expect(verify).not.toHaveBeenCalled();
  await expect(
    routing.resolveToolSource(owner, f.alias, signal(), call),
  ).resolves.toMatchObject({ evidenceId: f.alias.evidenceId });
  expect(verify).toHaveBeenCalledTimes(2);
  verify.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(
    routing.resolveToolSource(owner, f.alias, signal(), call),
  ).resolves.toBeUndefined();
});

test('failed owner validation returns unavailable without reading sources', async () => {
  const routing = createColdConversationSourceResolvers(),
    f = source('synthetic');
  routing.register({
    owner,
    registry: f.registry,
    isCurrent: async () => {
      throw new Error('synthetic DB unavailable');
    },
  });
  await expect(routing.readSource(owner, f.alias, signal())).resolves.toEqual({
    status: 'unavailable',
  });
  expect(f.readSource).not.toHaveBeenCalled();
});
