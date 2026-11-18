import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';
import { bindConversationToolSource } from '../bindConversationToolSource';
import { captureConversationSources } from '../captureConversationSources';
import { hasConversationToolCapture } from '../evidenceCaptureBatch';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

async function fixture() {
  const f = await sharedAncestryProfileFixture(1, false);
  const row = (await f.storage.read('turn-0'))!;
  const event = {
    version: 1 as const,
    operationRunId: 'run',
    callId: 'call',
    toolName: 'health',
    order: 1,
    status: 'completed' as const,
    inputSummary: { sourceKind: 'generated_artifact' as const },
    resultSummary: { referenceCount: 1 },
    sources: row.citations!,
  };
  await f.storage.appendToolEvent({
    sessionId: 'session',
    messageId: row.id,
    createdAt: row.createdAt,
    sessionVersion: (await f.storage.activeSessionVersion('session'))!,
    event,
    dependencies: row.sources,
  });
  const turn = (await f.storage.readToolTurns('session'))[0]!;
  let valid = true;
  const read = jest.fn(async () =>
    valid
      ? {
          status: 'available' as const,
          document: { sourceKind: 'personal_record' as const, records: [] },
        }
      : { status: 'changed' as const },
  );
  const validate = jest.fn(async () => valid);
  const registry = f.input.registry;
  const reference = {
    ...row.citations![0]!,
    sourceKind: 'personal_record' as const,
  };
  const alias = registry.add({
    reference,
    content: '',
    readSource: read,
    validate,
  });
  const input = {
    alias,
    sessionId: 'session',
    messageId: row.id,
    runId: event.operationRunId,
    callId: event.callId,
    snapshot: { event: turn.toolEvents[0], lineage: turn.lineages[0] },
    storage: f.storage,
    registry,
  };
  return {
    ...f,
    registry,
    reference,
    input,
    read,
    validate,
    invalidate: () => {
      valid = false;
    },
  };
}

test.each([
  'call-delete',
  'session-hide',
  'source-delete',
  'native-change',
  'abort',
  'storage-replace',
  'registry-read-replace',
  'registry-validate-replace',
] as const)(
  'tool capture final fence rejects %s during another source await',
  async mutation => {
    const f = await fixture();
    const controller = new AbortController();
    try {
      const bound = bindConversationToolSource(f.input);
      expect(hasConversationToolCapture(f.registry, bound)).toBe(true);
      const later = f.registry.add({
        reference: { ...f.reference, sourceId: 'later', evidenceId: 'later' },
        content: '',
        validate: async () => true,
        readSource: async () => {
          if (mutation === 'call-delete')
            await f.database.execute('DELETE FROM conversation_tool_events');
          if (mutation === 'session-hide')
            await f.database.execute(
              'UPDATE conversation_artifact_sessions SET hidden = 1',
            );
          if (mutation === 'source-delete')
            await f.repository.delete('health_observation', f.inside.id);
          if (mutation === 'native-change') f.invalidate();
          if (mutation === 'abort') controller.abort();
          if (mutation === 'storage-replace')
            f.storage.readToolTurns = async () => [];
          if (mutation === 'registry-read-replace')
            f.registry.readSource = async () => ({ status: 'unavailable' });
          if (mutation === 'registry-validate-replace')
            f.registry.revalidateEvidence = async () => false;
          return {
            status: 'available',
            document: { sourceKind: 'personal_record', records: [] },
          };
        },
      });
      await expect(
        captureConversationSources(
          [bound, later],
          f.registry,
          controller.signal,
        ),
      ).rejects.toThrow();
      expect(f.read).toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);

test('native callbacks run again at the final fence and live reads retain strict callbacks', async () => {
  const f = await fixture();
  try {
    const bound = bindConversationToolSource(f.input);
    await captureConversationSources(
      [bound],
      f.registry,
      new AbortController().signal,
    );
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.validate).toHaveBeenCalledTimes(2);
    f.invalidate();
    expect(
      (await f.registry.readSource(bound, new AbortController().signal)).status,
    ).not.toBe('available');
  } finally {
    f.close();
  }
});

test('custom reader and foreign registry cannot acquire tool capture authority', async () => {
  const f = await fixture();
  try {
    const strict = jest.fn(async () => []);
    const custom = bindConversationToolSource({
      ...f.input,
      storage: { readToolTurns: strict },
    });
    expect(hasConversationToolCapture(f.registry, custom)).toBe(false);
    await expect(
      captureConversationSources(
        [custom],
        f.registry,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(strict).toHaveBeenCalled();
    const foreign = new LocalEvidenceReferenceRegistry();
    expect(() =>
      bindConversationToolSource({ ...f.input, registry: foreign }),
    ).toThrow();
  } finally {
    f.close();
  }
});

test.each(['storage', 'registry'] as const)(
  'late %s replacement uses strict fallback, not saved authority',
  async kind => {
    const f = await fixture();
    try {
      const bound = bindConversationToolSource(f.input);
      const fallback = jest.fn(async () => []);
      const read = jest.fn(async () => ({ status: 'unavailable' as const }));
      if (kind === 'storage') f.storage.readToolTurns = fallback;
      else f.registry.readSource = read;
      await expect(
        captureConversationSources(
          [bound],
          f.registry,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(kind === 'storage' ? fallback : read).toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);

test.each(['other-session', 'other-snapshot'] as const)(
  'capture does not share a different %s',
  async mismatch => {
    const f = await fixture();
    try {
      const original = bindConversationToolSource(f.input);
      const foreign = bindConversationToolSource({
        ...f.input,
        ...(mismatch === 'other-session'
          ? { sessionId: 'other-session' }
          : {
              snapshot: {
                ...f.input.snapshot,
                event: { ...f.input.snapshot.event, order: 99 },
              },
            }),
      });
      await expect(
        captureConversationSources(
          [original, foreign],
          f.registry,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
    } finally {
      f.close();
    }
  },
);
