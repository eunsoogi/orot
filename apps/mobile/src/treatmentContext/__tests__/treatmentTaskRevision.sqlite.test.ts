import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { TreatmentExplanationRequest } from '../interfaces';
import { produceTreatmentRequest } from '../treatmentRequestProducer';

test('a saved task does not reopen a replacement artifact under its original revision', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const signal = new AbortController().signal;
    const request = {
      context: {
        version: 1,
        conditions: [],
        clinicianPlans: { status: 'unavailable' },
        publicEvidence: [],
        missingContext: [],
        conflicts: [],
      },
      sources: [],
      revalidateEvidence: async () => true,
    } as unknown as TreatmentExplanationRequest;
    expect(
      await produceTreatmentRequest(
        connection.database,
        { kind: 'request', selection: { kind: 'general_options' } },
        request,
        signal,
        [],
        {
          id: 'artifact',
          sessionId: 'session',
          createdAt: '2026-10-05T00:00:00.000Z',
          question: 'Synthetic original',
          expectedSessionVersion: 0,
        },
      ),
    ).toMatchObject({ status: 'validated' });
    const original = await storage.read('artifact');
    const [card] = await storage.readTaskCards('session', 0);
    expect(card?.task).toMatchObject({
      kind: 'treatment',
      artifactRevision: fingerprint(original),
    });
    await connection.database.execute(
      'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
      [
        JSON.stringify({ ...original, question: 'Synthetic replacement' }),
        'artifact',
      ],
    );
    const replacement = await storage.read('artifact');
    expect(replacement).not.toBeNull();
    expect(fingerprint(replacement)).not.toBe(fingerprint(original));
    expect(
      await produceTreatmentRequest(
        connection.database,
        {
          kind: 'reopen',
          artifactId: 'artifact',
          sessionId: 'session',
          sessionVersion: 0,
          expectedArtifactRevision: fingerprint(original),
        },
        request,
        signal,
        [],
      ),
    ).toEqual({ status: 'withheld', reason: 'unsupported' });
    expect(
      await produceTreatmentRequest(
        connection.database,
        {
          kind: 'reopen',
          artifactId: 'artifact',
          sessionId: 'session',
          sessionVersion: 0,
          expectedArtifactRevision: fingerprint(replacement),
        },
        request,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'validated' });
  } finally {
    connection.close();
  }
});
