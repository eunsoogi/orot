import { createRecordRepository, runMigrations } from '@orot/storage';
import type { EvidenceReference } from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { runRagConversationTurn } from '../../../ragConversation/service';
import {
  fixture,
  response,
} from '../../../ragConversation/testSupport/conversationEnvelopeFixtures';
import { openLocalStorage } from '../../../storage/secureDatabase';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { prepareConversationVisitTarget } from '../conversationVisitTarget';

jest.mock('../../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));

test('the real workflow admits only the current selected visit after consent', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const records = createRecordRepository(connection.database);
    jest.mocked(openLocalStorage).mockResolvedValue(records);
    const appointment = {
      id: 'target-visit',
      effectiveAt: '2090-06-02T09:30:00.000Z',
      recordedAt: '2026-01-01T00:00:00.000Z',
      ingestedAt: '2026-01-01T00:00:00.000Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      status: 'scheduled' as const,
      clinicLabel: '선택된 진료',
      calendarEventIdentifier: 'private-calendar',
      calendarEventSnapshot: {
        title: '합성 예약',
        timeZoneIdentifier: 'Asia/Seoul',
        isAllDay: false,
        occurrenceDate: null,
        isDetached: false,
        recurrenceRules: [],
      },
    };
    await records.put('appointment', appointment);
    const data = {
      ...localData([]).data,
      ...createLocalEvidenceData(connection.database),
      repository: createLocalHealthEvidenceRepository(connection.database),
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const target = await prepareConversationVisitTarget({
      data,
      registry,
      appointmentId: appointment.id,
      signal: new AbortController().signal,
    });
    if (!target) throw new Error('Expected selected visit');
    const f = fixture();
    f.generate.mockReset().mockResolvedValue(
      response({
        type: 'result',
        value: {
          answerKind: 'grounded',
          answer: '선택한 진료가 예정되어 있어요.',
        },
        citations: [target.evidenceId],
      }),
    );
    const authorize = jest.fn(async () => 'authorized' as const);
    const options = {
      ...f.options,
      question: '수정한 요청',
      entryIntent: 'visit-questions' as const,
      targetVisitEvidence: target,
      loadCurrentEvidence: async () => ({
        batch: { items: [], coverage: [], conflicts: [] },
        chunks: [],
      }),
      resolveLocalEvidenceIdentity: (reference: EvidenceReference) =>
        registry.resolve(reference),
      workflow: {
        ...f.options.workflow,
        execution: {
          ...f.options.workflow.execution,
          remoteProcessing: true,
          allowedScope: { sourceKinds: ['personal_record' as const] },
          consentScope: {
            purpose: 'record_conversation' as const,
            dataCategories: ['health_records' as const],
            policyVersion: 'test',
          },
        },
        consent: { authorize },
        revalidateEvidence: (
          references: readonly EvidenceReference[],
          signal: AbortSignal,
        ) => registry.revalidateEvidence(references, signal),
      },
    };
    const result = await runRagConversationTurn(options);
    expect(result.status).toBe('answer');
    expect(authorize).toHaveBeenCalled();
    const modelRequest = JSON.stringify(f.generate.mock.calls[0]![0]);
    expect(modelRequest).toContain(target.evidenceId);
    expect(modelRequest).toContain('visit-questions');
    expect(modelRequest).not.toContain(appointment.id);
    expect(modelRequest).not.toContain(appointment.calendarEventIdentifier);
    await records.put('appointment', { ...appointment, status: 'cancelled' });
    f.generate.mockClear();
    expect(await runRagConversationTurn(options)).toMatchObject({
      status: 'failure',
      kind: 'stale_evidence',
    });
    expect(f.generate).not.toHaveBeenCalled();
  } finally {
    connection.close();
  }
});
