import {
  scope,
  call,
  source,
  fixture,
} from '../testSupport/researchScopeRecoveryFixture';
import { LocalEvidenceReferenceRegistry as Registry } from '../evidenceRegistry';
import { createResearchInputTracker } from '../researchInputTracker';
test('scope restore preserves pending and ready identity, filters foreign runs, and invokes no readers', () => {
  const f = fixture();
  f.registry.toolReferences.bindResearch(source, f.other, {
    ...call,
    operationRunId: 'other-run',
  });
  const snapshot = f.registry.toolReferences.snapshotScope(
    scope,
    ['tool-1'],
    f.resolve,
  );
  expect(snapshot).toEqual(f.snapshot);
  const receipt = f.fresh.toolReferences.restoreScope(
    snapshot,
    scope,
    ['tool-1'],
    ref => f.fresh.resolve(ref),
  );
  expect(f.fresh.toolReferences.findResearch(source, call)).toEqual(f.alias);
  expect(f.fresh.toolReferences.findResearch(source, call, true)).toEqual(
    f.alias,
  );
  expect(
    f.fresh.toolReferences.findResearch(source, {
      ...call,
      operationRunId: 'other-run',
    }),
  ).toBeUndefined();
  expect(
    f.fresh.toolReferences.acceptsScopeReceipt(receipt, scope, [f.alias]),
  ).toBe(true);
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.readSource).not.toHaveBeenCalled();
  expect(() =>
    f.fresh.toolReferences.restoreScope(snapshot, scope, ['tool-1'], ref =>
      f.fresh.resolve(ref),
    ),
  ).toThrow();
});

test('ambiguity tombstones are retained but cannot unlock external research or be promoted to ready', () => {
  const f = fixture();
  f.registry.toolReferences.bindResearch(source, f.other, call);
  const snapshot = f.registry.toolReferences.snapshotScope(
    scope,
    ['tool-1'],
    f.resolve,
  );
  expect(snapshot.pending[0].target).toBeNull();
  const receipt = f.fresh.toolReferences.restoreScope(
    snapshot,
    scope,
    ['tool-1'],
    ref => f.fresh.resolve(ref),
  );
  expect(f.fresh.toolReferences.findResearch(source, call)).toBeUndefined();
  expect(f.fresh.toolReferences.findResearch(source, call, true)).toEqual(
    f.alias,
  );
  expect(f.fresh.toolReferences.acceptsScopeReceipt(receipt, scope, [])).toBe(
    false,
  );
});

test.each([
  'run',
  'call',
  'alias',
  'revision',
  'duplicate',
  'missing',
] as const)(
  'rejects %s corruption atomically without installing bindings',
  change => {
    const f = fixture();
    const saved = JSON.parse(JSON.stringify(f.snapshot));
    if (change === 'run') saved.scope.operationRunId = 'other-run';
    if (change === 'call') saved.ready[0].callId = 'tool-999';
    if (change === 'alias') saved.ready[0].target.alias.evidenceId = 'e999';
    if (change === 'revision')
      saved.ready[0].target.original.sourceRevision = 'other';
    if (change === 'duplicate') saved.pending.push(saved.pending[0]);
    if (change === 'missing') delete saved.pending;
    expect(() =>
      f.fresh.toolReferences.restoreScope(saved, scope, ['tool-1'], ref =>
        f.fresh.resolve(ref),
      ),
    ).toThrow();
    expect(
      f.fresh.toolReferences.findResearch(source, call, true),
    ).toBeUndefined();
    expect(f.fresh.toolReferences.findResearch(source, call)).toBeUndefined();
  },
);

test('tracker requires exact same-index receipt and original retained lineage, and preserves incomplete', async () => {
  const f = fixture();
  const receipt = f.fresh.toolReferences.restoreScope(
    f.snapshot,
    scope,
    ['tool-1'],
    ref => f.fresh.resolve(ref),
  );
  const restore = (
    snapshot = f.trackerSnapshot,
    proof = receipt,
    registry = f.fresh,
  ) =>
    createResearchInputTracker(registry, undefined, scope.sessionId, {
      snapshot,
      scope: { operationRunId: scope.operationRunId, receipt: proof },
    });
  const tracker = restore();
  await expect(tracker.revalidate(new AbortController().signal)).resolves.toBe(
    true,
  );
  expect(f.validate).toHaveBeenCalled();
  f.validate.mockResolvedValue(false);
  await expect(tracker.revalidate(new AbortController().signal)).resolves.toBe(
    false,
  );
  f.validate.mockResolvedValue(true);
  await expect(
    restore({ ...f.trackerSnapshot, incomplete: true }).revalidate(
      new AbortController().signal,
    ),
  ).resolves.toBe(false);
  await expect(
    restore(f.trackerSnapshot, { ...receipt }).revalidate(
      new AbortController().signal,
    ),
  ).resolves.toBe(false);
  const unrelated = Registry.restore(f.registry.snapshot(), f.registry);
  await expect(
    restore(f.trackerSnapshot, receipt, unrelated).revalidate(
      new AbortController().signal,
    ),
  ).resolves.toBe(false);
  const wrongRun = createResearchInputTracker(
    f.fresh,
    undefined,
    scope.sessionId,
    {
      snapshot: f.trackerSnapshot,
      scope: { operationRunId: 'wrong', receipt },
    },
  );
  await expect(wrongRun.capture(new AbortController().signal)).rejects.toThrow(
    'lineage',
  );
});

test('explicitly captured empty scope can restore empty lineage, but absent calls and receipts cannot', async () => {
  const registry = new Registry();
  const snapshot = registry.toolReferences.snapshotScope(scope, [], ref =>
    registry.resolve(ref),
  );
  const fresh = new Registry();
  const receipt = fresh.toolReferences.restoreScope(snapshot, scope, [], ref =>
    fresh.resolve(ref),
  );
  const inputs = createResearchInputTracker(registry).snapshot();
  const tracker = createResearchInputTracker(
    fresh,
    undefined,
    scope.sessionId,
    {
      snapshot: inputs,
      scope: { operationRunId: scope.operationRunId, receipt },
    },
  );
  await expect(tracker.capture(new AbortController().signal)).resolves.toEqual(
    [],
  );
  expect(() =>
    fresh.toolReferences.restoreScope(snapshot, scope, [], ref =>
      fresh.resolve(ref),
    ),
  ).toThrow();
  const f = fixture();
  expect(() =>
    f.fresh.toolReferences.restoreScope(f.snapshot, scope, [], ref =>
      f.fresh.resolve(ref),
    ),
  ).toThrow();
});
