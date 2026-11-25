import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import * as evidence from '../../aiFeatures/integration/evidenceUtils';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import * as scoped from '../writeTypedFingerprintScope';

const row = healthObservation(
  'synthetic-typed-evidence',
  'heart_rate',
  '2026-10-01T00:00:00Z',
);
const artifact = {
  id: 'synthetic-turn',
  sessionId: 'synthetic-session',
  createdAt: '2026-10-05T00:00:00.000Z',
  providerId: 'synthetic',
  modelId: 'synthetic',
  status: 'complete' as const,
  question: 'Synthetic question',
  answer: 'Synthetic answer',
  sources: Array.from({ length: 8 }, (_, index) => ({
    reference: {
      ...reference,
      sourceId: 'synthetic-source-' + index,
      evidenceId: 'synthetic-reference-' + index,
    },
    records: [
      {
        kind: 'health_observation' as const,
        id: row.id,
        revision: evidence.fingerprint(row),
      },
    ],
  })),
};

test.each(['unchanged', 'changed', 'missing', 'stale'] as const)(
  'final append preserves each actual typed read and validation with %s rows',
  async scenario => {
    for (const baseline of [true, false]) {
      const sqlite = openSqliteTestDatabase(':memory:');
      let count = 0;
      let observe = false;
      const owner: SqlDatabase = {
        execute: sqlite.database.execute,
        transaction: callback =>
          sqlite.database.transaction(tx =>
            callback({
              ...tx,
              async execute(sql, binds) {
                const result = await tx.execute(sql, binds);
                if (
                  observe &&
                  sql.includes('r.payload_json AS source_json') &&
                  sql.includes('FROM health_observations r')
                ) {
                  count++;
                  // Inject an actual sibling mutation at the same SQLite
                  // boundary, not a forged mutable JavaScript row.
                  if (count === 1 && scenario === 'changed')
                    await tx.execute(
                      'UPDATE health_observations SET payload_json = json_set(payload_json, ?, ?) WHERE id = ?',
                      ['$.value.amount', 999, row.id],
                    );
                  if (count === 1 && scenario === 'missing')
                    await tx.execute(
                      'DELETE FROM health_observations WHERE id = ?',
                      [row.id],
                    );
                  if (count === 1 && scenario === 'stale')
                    await tx.execute(
                      'INSERT INTO transcript_artifact_staleness(transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES(?,?,?,?,?,?)',
                      [
                        'synthetic-transcript',
                        'health_observation',
                        row.id,
                        'old',
                        'new',
                        row.ingestedAt,
                      ],
                    );
                }
                return result;
              },
            }),
          ),
      };
      const fingerprint = jest.spyOn(evidence, 'fingerprint');
      const strict = baseline
        ? jest
            .spyOn(scoped, 'withWriteTypedFingerprints')
            .mockImplementation((_tx, validate) => validate())
        : undefined;
      try {
        await runMigrations(owner);
        await createRecordRepository(owner).put('health_observation', row);
        const store = createConversationArtifactStorage(owner);
        await store.createSession(
          artifact.sessionId,
          await store.currentGeneration(),
        );
        fingerprint.mockClear();
        observe = true;
        const saving = store.append(artifact);
        if (scenario === 'unchanged') {
          await expect(saving).resolves.toBeUndefined();
          expect(
            fingerprint.mock.calls.filter(
              ([value]) => (value as { id?: string } | null)?.id === row.id,
            ),
          ).toHaveLength(baseline ? 8 : 1);
          expect(count).toBe(8);
          observe = false;
          expect((await store.read(artifact.id))?.sources).toEqual(
            artifact.sources,
          );
        } else {
          await expect(saving).rejects.toMatchObject({
            reason: scenario === 'missing' ? 'deleted' : scenario,
          });
          expect(count).toBe(2);
          observe = false;
          expect(await store.read(artifact.id)).toBeNull();
          expect(
            (
              await owner.execute(
                'SELECT artifact_id FROM conversation_artifact_sources WHERE artifact_id = ?',
                [artifact.id],
              )
            ).rows,
          ).toEqual([]);
        }
      } finally {
        fingerprint.mockRestore();
        strict?.mockRestore();
        sqlite.close();
      }
    }
  },
);

test('ignores nonmatching owners and clears cached bytes on failure and reuse', async () => {
  const tx = { execute: jest.fn() };
  const other = { execute: jest.fn() };
  const key = { kind: 'health_observation', id: 'synthetic' };
  const serialized = JSON.stringify(row);
  const fingerprint = jest.spyOn(evidence, 'fingerprint');
  try {
    await expect(
      scoped.withWriteTypedFingerprints(tx, async () => {
        expect(scoped.writeTypedFingerprint(other, key, serialized)).toBe(
          undefined,
        );
        scoped.writeTypedFingerprint(tx, key, serialized);
        scoped.writeTypedFingerprint(tx, key, serialized);
        expect(fingerprint).toHaveBeenCalledTimes(1);
        throw new Error('Synthetic validation abort');
      }),
    ).rejects.toThrow('Synthetic validation abort');
    expect(scoped.writeTypedFingerprint(tx, key, serialized)).toBeUndefined();
    await scoped.withWriteTypedFingerprints(tx, async () => {
      scoped.writeTypedFingerprint(tx, key, serialized);
      expect(fingerprint).toHaveBeenCalledTimes(2);
    });
  } finally {
    fingerprint.mockRestore();
  }
});

test('large typed row bytes are still validated, not cached past the envelope', async () => {
  const tx = { execute: jest.fn() };
  const key = { kind: 'source_record', id: 'synthetic' };
  const large = JSON.stringify({ contents: 'x'.repeat(140_000) });
  const fingerprint = jest.spyOn(evidence, 'fingerprint');
  try {
    await scoped.withWriteTypedFingerprints(tx, async () => {
      const digest = scoped.writeTypedFingerprint(tx, key, large);
      expect(scoped.writeTypedFingerprint(tx, key, large)).toBe(digest);
      expect(fingerprint).toHaveBeenCalledTimes(2);
    });
  } finally {
    fingerprint.mockRestore();
  }
});

test('memory is bounded by both typed entry count and exact identity', async () => {
  const tx = { execute: jest.fn() };
  const raw = JSON.stringify({ sample: 'synthetic' });
  const fingerprint = jest.spyOn(evidence, 'fingerprint');
  try {
    await scoped.withWriteTypedFingerprints(tx, async () => {
      const key = { kind: 'health_observation', id: 'shared-id' };
      scoped.writeTypedFingerprint(tx, key, raw);
      scoped.writeTypedFingerprint(tx, { ...key, kind: 'source_record' }, raw);
      expect(fingerprint).toHaveBeenCalledTimes(2);
      for (let index = 0; index < 254; index++)
        scoped.writeTypedFingerprint(tx, { ...key, id: String(index) }, raw);
      const overflow = { ...key, id: 'new-id' };
      const expected = scoped.writeTypedFingerprint(tx, overflow, raw);
      expect(scoped.writeTypedFingerprint(tx, overflow, raw)).toBe(expected);
      scoped.writeTypedFingerprint(tx, key, raw);
      expect(fingerprint).toHaveBeenCalledTimes(258);
    });
  } finally {
    fingerprint.mockRestore();
  }
});
