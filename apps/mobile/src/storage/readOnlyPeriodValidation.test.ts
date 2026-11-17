import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import { createManualHistoryRepository } from '@orot/storage';
import { healthContextFixture } from '../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import * as reader from '../healthEvidence/healthContext/reader';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { createConversationArtifactStorage } from './conversationArtifactStorage';
import { createReadOnlyPeriodValidation } from './readOnlyPeriodValidation';
import { assertRetainedEvidenceCurrent } from './retainedEvidenceFreshness';
import { revalidateSummaryArtifacts } from './summaryArtifactRevalidation';
import { isPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';

afterEach(() => jest.restoreAllMocks());

test('five retained turns share one period recalculation, but a new transaction sees deletion', async () => {
  const f = await healthContextFixture();
  try {
    const store = createConversationArtifactStorage(f.database);
    await store.createSession('session', await store.currentGeneration());
    const ids = Array.from({ length: 5 }, (_, i) => `turn-${i}`);
    for (const id of ids) {
      await store.append({
        id,
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'synthetic',
        modelId: 'synthetic',
        status: 'complete',
        question: 'Synthetic request',
        answer: 'Synthetic answer',
        sources: f.saved.sources,
      });
    }
    const spy = jest.spyOn(reader, 'readHealthContextReport');
    expect((await store.readMany(ids)).filter(Boolean)).toHaveLength(5);
    expect(spy).toHaveBeenCalledTimes(1);
    // Every root is still queried even when its period has already passed.
    await f.database.execute(
      'DELETE FROM conversation_artifacts WHERE id = ?',
      [ids[1]],
    );
    spy.mockClear();
    expect((await store.readMany(ids)).map(Boolean)).toEqual([
      true,
      false,
      true,
      true,
      true,
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    await f.database.execute('DELETE FROM health_observations WHERE id = ?', [
      f.inside.id,
    ]);
    expect(await store.readMany(ids)).toEqual([null, null, null, null, null]);
  } finally {
    f.close();
  }
});

test('summary read-only batch shares period validation while checking each root revision', async () => {
  const f = await healthContextFixture();
  try {
    const items = Array.from({ length: 5 }, (_, i) => ({
      ...f.saved,
      id: `summary-${i}`,
    }));
    for (const item of items) await f.storage.append(item);
    const refs = items.map(item => ({
      id: item.id,
      revision: fingerprint(item),
    }));
    const spy = jest.spyOn(reader, 'readHealthContextReport');
    expect(await revalidateSummaryArtifacts(f.database, refs)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(
      await revalidateSummaryArtifacts(f.database, [
        ...refs,
        { ...refs[0]!, revision: 'changed' },
      ]),
    ).toBe(false);
  } finally {
    f.close();
  }
});

test('success keys distinguish versions, scope and generation requirements; failures are retried', async () => {
  const f = await healthContextFixture();
  try {
    const source = f.saved.sources.find(isPeriodSummarySource)!;
    const spy = jest.spyOn(reader, 'readHealthContextReport');
    await f.database.transaction(async tx => {
      const validate = createReadOnlyPeriodValidation(tx);
      await validate(tx, source, false);
      await validate(tx, source, false);
      expect(spy).toHaveBeenCalledTimes(1);
      await validate(tx, source, true);
      await validate(
        tx,
        { ...source, deletionGeneration: source.deletionGeneration + 1 },
        false,
      );
      const invalid = { ...source, revision: 'changed' };
      await expect(validate(tx, invalid, false)).rejects.toThrow();
      await expect(validate(tx, invalid, false)).rejects.toThrow();
      await expect(
        validate(
          tx,
          { ...source, deletionGeneration: source.deletionGeneration + 1 },
          true,
        ),
      ).rejects.toThrow();
      await expect(
        validate(
          tx,
          {
            ...source,
            scope: {
              ...source.scope,
              window: {
                ...source.scope.window,
                toExclusive: '2026-10-01T00:00:00Z',
              },
            },
          },
          false,
        ),
      ).rejects.toThrow();
      expect(spy).toHaveBeenCalledTimes(7);
    });
  } finally {
    f.close();
  }
});

test('ordinary write-transaction validation does not memoize and observes source mutations', async () => {
  const f = await healthContextFixture();
  try {
    // Production writes open the owning catalog before transaction-only validation.
    await f.storage.list();
    const history = createManualHistoryRepository(f.database);
    await f.database.transaction(async tx => {
      await assertRetainedEvidenceCurrent(tx, f.saved.sources, history);
      await tx.execute('DELETE FROM health_observations WHERE id = ?', [
        f.inside.id,
      ]);
      await expect(
        assertRetainedEvidenceCurrent(tx, f.saved.sources, history),
      ).rejects.toThrow();
    });
  } finally {
    f.close();
  }
});

test('a cached period cannot bypass a newly inserted deletion fence in the same transaction', async () => {
  const f = await healthContextFixture();
  try {
    const store = createConversationArtifactStorage(f.database);
    await store.createSession('session', await store.currentGeneration());
    const value = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'synthetic',
      modelId: 'synthetic',
      status: 'complete' as const,
      question: 'Synthetic request',
      answer: 'Synthetic answer',
      sources: f.saved.sources,
    };
    await store.append(value);
    await f.database.transaction(async tx => {
      const validate = createReadOnlyPeriodValidation(tx);
      await assertConversationArtifactCurrent(
        tx,
        f.database,
        value,
        false,
        validate,
      );
      // Adversarial same-transaction mutation: fences must remain outside the period memo.
      // Production read batches never perform this write.
      await tx.execute(
        'INSERT INTO source_deletion_tombstones (source_id) VALUES (?)',
        [f.inside.id],
      );
      await expect(
        assertConversationArtifactCurrent(
          tx,
          f.database,
          value,
          false,
          validate,
        ),
      ).rejects.toThrow('period source was removed');
    });
  } finally {
    f.close();
  }
});

test.each(['update', 'delete'])(
  'interleaved same-connection quantity %s invalidates a memo in the same transaction',
  async action => {
    const f = await healthContextFixture();
    try {
      const source = f.saved.sources.find(isPeriodSummarySource)!;
      await f.database.transaction(async tx => {
        const validate = createReadOnlyPeriodValidation(tx);
        await validate(tx, source, false);
        // Native non-transaction execute may run between awaited reads on this connection.
        await f.database.execute(
          action === 'update'
            ? "UPDATE health_observations SET payload_json = json_set(payload_json, '$.value.amount', 99) WHERE id = ?"
            : 'DELETE FROM health_observations WHERE id = ?',
          [f.inside.id],
        );
        await expect(validate(tx, source, false)).rejects.toThrow();
      });
    } finally {
      f.close();
    }
  },
);
