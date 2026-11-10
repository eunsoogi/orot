import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { TreatmentExplanationRequest } from '../interfaces';
import { produceTreatmentRequest } from '../treatmentRequestProducer';

test('withholds a follow-up when the retained session is hidden during verification', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const store = createConversationArtifactStorage(db.database);
    await store.createSession('session', await store.currentGeneration());
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
    const signal = new AbortController().signal;
    expect(
      await produceTreatmentRequest(
        db.database,
        { kind: 'request', selection: { kind: 'general_options' } },
        request,
        signal,
        [],
        {
          id: 'first',
          sessionId: 'session',
          createdAt: '2026-10-05T00:00:00.000Z',
          question: 'Synthetic',
          expectedSessionVersion: 0,
        },
      ),
    ).toMatchObject({ status: 'validated' });
    const cancelled = new AbortController();
    expect(
      await produceTreatmentRequest(
        db.database,
        {
          kind: 'follow_up',
          artifactId: 'first',
          selection: { kind: 'general_options' },
        },
        {
          ...request,
          revalidateEvidence: async () => {
            cancelled.abort();
            return true;
          },
        },
        cancelled.signal,
        [],
      ),
    ).toEqual({ status: 'withheld', reason: 'cancelled' });
    let hidden = false;
    const duringVerification = {
      ...request,
      revalidateEvidence: async () => {
        if (!hidden) {
          hidden = true;
          await store.hideSession('session', 0);
        }
        return true;
      },
    };
    expect(
      await produceTreatmentRequest(
        db.database,
        {
          kind: 'follow_up',
          artifactId: 'first',
          selection: { kind: 'general_options' },
        },
        duringVerification,
        signal,
        [],
      ),
    ).toEqual({ status: 'withheld', reason: 'unsupported' });
    expect(hidden).toBe(true);
  } finally {
    db.close();
  }
});
