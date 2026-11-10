import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { treatmentSafetyKo } from '../../i18n/treatmentSafety';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { TreatmentExplanationRequest } from '../interfaces';
import { createTreatmentSafetyService } from '../treatmentSafetyService';

test.each(['correct', 'delete'] as const)(
  'revalidates generated and reopened claims and withholds after source %s',
  async action => {
    const directory = mkdtempSync(join(tmpdir(), 'treatment-safety-'));
    const path = join(directory, 'records.sqlite');
    let connection = openSqliteTestDatabase(path);
    try {
      await runMigrations(connection.database);
      let history = createManualHistoryRepository(connection.database);
      const entry = await history.create({
        kind: 'diagnosis_history',
        title: 'Synthetic',
        details: 'Reported history',
        effectiveDate: { status: 'unknown' },
      });
      const revision = fingerprint(await history.getEvidence(entry.id));
      const reference = {
        sourceKind: 'personal_record' as const,
        sourceId: entry.id,
        sourceRevision: revision,
        evidenceId: entry.id,
        evidenceRevision: revision,
        locator: {},
        effectiveTime: null,
        reviewState: 'unknown' as const,
      };
      const record = {
        kind: 'manual_history' as const,
        id: entry.id,
        revision,
      };
      const context = {
        version: 1 as const,
        clinicianPlans: { status: 'unavailable' as const },
        conditions: [
          {
            status: 'user_reported' as const,
            source: reference,
            record,
            uncertainty: 'Date unknown',
          },
        ],
        publicEvidence: [],
        missingContext: ['Date'],
        conflicts: [],
      };
      const sources = [{ reference, records: [record] }];
      const request = {
        context,
        sources,
        revalidateEvidence: async () => true,
      } as unknown as TreatmentExplanationRequest;
      const text = treatmentSafetyKo['treatmentSafety.reportedCondition'];
      const envelope = { claims: [{ text, citations: [reference] }] };
      let service = createTreatmentSafetyService(connection.database);
      expect(
        await service.generate(
          {},
          async () => envelope,
          request,
          new AbortController().signal,
          [],
        ),
      ).toMatchObject({ status: 'validated' });
      let store = createConversationArtifactStorage(connection.database);
      await store.createSession('session', await store.currentGeneration());
      const candidate = {
        id: 'turn',
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'synthetic',
        modelId: 'synthetic',
        status: 'complete' as const,
        question: 'Synthetic question',
        answer: text,
        sources,
        citations: [reference],
        treatmentContext: context,
      };
      expect(
        await service.save(
          { ...candidate, id: 'unsafe', answer: '이 약을 중단하세요.' },
          request,
          new AbortController().signal,
          [],
        ),
      ).toMatchObject({ status: 'withheld' });
      expect(await store.read('unsafe')).toBeNull();
      expect(
        await service.save(
          {
            ...candidate,
            id: 'unsafe-prior',
            priorDialogue: [
              { question: '이전 질문', answer: '이 약을 중단하세요.' },
            ],
          },
          request,
          new AbortController().signal,
          [],
        ),
      ).toMatchObject({ status: 'withheld' });
      expect(await store.read('unsafe-prior')).toBeNull();
      const cancelled = new AbortController();
      cancelled.abort();
      expect(
        await service.save(
          { ...candidate, id: 'cancelled' },
          request,
          cancelled.signal,
          [],
        ),
      ).toMatchObject({ status: 'withheld', reason: 'cancelled' });
      expect(await store.read('cancelled')).toBeNull();
      expect(
        await service.save(
          candidate,
          request,
          new AbortController().signal,
          [],
        ),
      ).toMatchObject({ status: 'validated' });
      expect(
        await service.save(
          {
            ...candidate,
            id: 'safe-prior',
            priorDialogue: [{ question: '이전 질문', answer: text }],
          },
          request,
          new AbortController().signal,
          [],
        ),
      ).toMatchObject({ status: 'validated' });
      connection.close();
      connection = openSqliteTestDatabase(path);
      history = createManualHistoryRepository(connection.database);
      store = createConversationArtifactStorage(connection.database);
      service = createTreatmentSafetyService(connection.database);
      expect(
        await service.reopen('turn', request, new AbortController().signal, []),
      ).toMatchObject({ status: 'validated' });
      expect(
        await service.reopen(
          'safe-prior',
          request,
          new AbortController().signal,
          [],
        ),
      ).toMatchObject({ status: 'validated' });
      // A subsequent turn must pass the same independent checks again.
      expect(
        await service.generate(
          {},
          async () => ({
            claims: [
              {
                text: treatmentSafetyKo['treatmentSafety.discussOptions'],
                citations: [],
              },
            ],
          }),
          request,
          new AbortController().signal,
          [],
        ),
      ).toMatchObject({ status: 'validated' });
      if (action === 'delete') await history.delete(entry.id);
      else
        await history.correct(entry.id, {
          kind: 'diagnosis_history',
          title: 'Changed',
          details: 'Updated',
          effectiveDate: { status: 'unknown' },
        });
      expect(
        await service.reopen('turn', request, new AbortController().signal, []),
      ).toMatchObject({ status: 'withheld' });
      expect(
        await service.generate(
          {},
          async () => envelope,
          request,
          new AbortController().signal,
          [],
        ),
      ).toMatchObject({ status: 'withheld' });
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
