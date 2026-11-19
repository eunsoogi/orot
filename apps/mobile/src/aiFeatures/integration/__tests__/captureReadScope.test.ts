import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import * as scopes from '../conversationCaptureReadScope';
import { captureConversationSources } from '../captureConversationSources';
import { validateCaptureHistory } from '../evidenceCaptureBatch';

/** Scope disposal releases calculations, while escaped reads remain strict. */
test.each(['success', 'throw', 'abort'] as const)(
  'capture finally releases %s, even without finish',
  async mode => {
    const f = await diverseHistoryProfileFixture(1, false);
    const controller = new AbortController();
    const original = scopes.createConversationCaptureReadScope;
    const created: ReturnType<typeof original>[] = [];
    const spy = jest
      .spyOn(scopes, 'createConversationCaptureReadScope')
      .mockImplementation(signal => {
        const scope = original(signal);
        created.push(scope);
        return scope;
      });
    let escaped: ReturnType<ReturnType<typeof original>['forStorage']>;
    try {
      const ref = f.input.registry.add({
        reference: {
          sourceKind: 'personal_record',
          sourceId: 'test-record',
          evidenceId: 'test-record',
          sourceRevision: 'revision',
          evidenceRevision: 'revision',
          locator: { kind: 'record' },
          effectiveTime: null,
          reviewState: 'unknown',
        },
        content: '',
        validate: async () => true,
        readSource: async () => {
          escaped = created[0]!.forStorage(f.storage)!;
          await escaped.read('turn-0');
          if (mode === 'throw') throw new Error('Synthetic native failure');
          if (mode === 'abort') controller.abort();
          return {
            status: 'available',
            document: { sourceKind: 'personal_record', records: [] },
          };
        },
      });
      const run = captureConversationSources(
        [ref],
        f.input.registry,
        controller.signal,
      );
      if (mode === 'success') await run;
      else await expect(run).rejects.toThrow();
      expect(created).toHaveLength(1);
      expect(created[0]!.forStorage(f.storage)).toBeUndefined();
      expect(escaped!.healthContextReportScope).toBeUndefined();
      await f.repository.delete('health_observation', f.inside.id);
      await expect(escaped!.read('turn-0')).resolves.toBeNull();
    } finally {
      spy.mockRestore();
      f.close();
    }
  },
);

test.each([
  'readManyWithAncestry',
  'readSessionMany',
  'readToolTurnsSnapshot',
  'beginReadOperation',
] as const)('late %s replacement never lends a cached reader', async method => {
  const f = await diverseHistoryProfileFixture(1, false);
  const scope = scopes.createConversationCaptureReadScope(
    new AbortController().signal,
  );
  try {
    const operation = scope.forStorage(f.storage)!;
    await operation.read('turn-0');
    const original = f.storage[method];
    Object.assign(f.storage, {
      [method]: (...args: never[]) =>
        (original as Function).apply(f.storage, args),
    });
    expect(operation.healthContextReportScope).toBeUndefined();
    if (method === 'beginReadOperation')
      expect(scope.forStorage(f.storage)).toBeUndefined();
    await f.repository.delete('health_observation', f.inside.id);
    await expect(operation.read('turn-0')).resolves.toBeNull();
  } finally {
    scope.dispose();
    f.close();
  }
});

test('foreign DB operations are distinct and already-aborted scopes never open', async () => {
  const a = await diverseHistoryProfileFixture(1, false);
  const b = await diverseHistoryProfileFixture(1, false);
  const controller = new AbortController();
  const scope = scopes.createConversationCaptureReadScope(controller.signal);
  try {
    const one = scope.forStorage(a.storage)!;
    const two = scope.forStorage(b.storage)!;
    expect(one).not.toBe(two);
    expect(one.healthContextReportScope).not.toBe(two.healthContextReportScope);
    await one.read('turn-0');
    await two.read('turn-0');
    await a.repository.delete('health_observation', a.inside.id);
    expect(await one.read('turn-0')).toBeNull();
    expect(await two.read('turn-0')).not.toBeNull();
    controller.abort();
    expect(one.healthContextReportScope).toBeUndefined();
    expect(two.healthContextReportScope).toBeUndefined();
    const aborted = scopes.createConversationCaptureReadScope(
      controller.signal,
    );
    expect(aborted.forStorage(a.storage)).toBeUndefined();
    aborted.dispose();
  } finally {
    scope.dispose();
    a.close();
    b.close();
  }
});

test('history fallback rejection disposes its independent scope', async () => {
  const f = await diverseHistoryProfileFixture(1, false);
  const original = scopes.createConversationCaptureReadScope;
  let scope: ReturnType<typeof original> | undefined;
  const spy = jest
    .spyOn(scopes, 'createConversationCaptureReadScope')
    .mockImplementation(signal => (scope = original(signal)));
  try {
    const ref = f.input.registry.add({
      reference: f.item,
      content: '',
      readSource: async () => ({ status: 'missing' }),
      validate: async () => false,
    });
    expect(
      await validateCaptureHistory(
        f.input.registry,
        [ref],
        new AbortController().signal,
      ),
    ).toBe(false);
    expect(scope!.forStorage(f.storage)).toBeUndefined();
  } finally {
    spy.mockRestore();
    f.close();
  }
});

/** Factory provenance is checked before the first operation, not learned from wrappers. */
test('a replaced begin callback is not adopted before the first capture read', async () => {
  const f = await diverseHistoryProfileFixture(1, false);
  const scope = scopes.createConversationCaptureReadScope(
    new AbortController().signal,
  );
  const original = f.storage.beginReadOperation;
  const custom = jest.fn((...args: Parameters<typeof original>) =>
    original.apply(f.storage, args),
  );
  Object.assign(f.storage, { beginReadOperation: custom });
  try {
    expect(scope.forStorage(f.storage)).toBeUndefined();
    expect(custom).not.toHaveBeenCalled();
    await expect(f.storage.read('turn-0')).resolves.not.toBeNull();
  } finally {
    scope.dispose();
    f.close();
  }
});
