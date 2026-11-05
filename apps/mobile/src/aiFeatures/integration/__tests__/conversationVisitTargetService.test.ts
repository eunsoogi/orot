import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';
import { createAiFeatureServices } from '../featureServices';

test('passes the intended current visit as revalidated evidence and never substitutes another', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const records = createRecordRepository(connection.database);
    const appointment = {
      id: 'target-private',
      effectiveAt: '2090-06-02T09:30:00.000Z',
      recordedAt: '2026-01-01T00:00:00.000Z',
      ingestedAt: '2026-01-01T00:00:00.000Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      status: 'scheduled' as const,
      clinicLabel: '선택된 진료',
      calendarEventIdentifier: 'calendar-private',
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
    await records.put('appointment', {
      ...appointment,
      id: 'other-private',
      clinicLabel: '다른 진료',
    });
    const data = {
      ...localData([]).data,
      ...createLocalEvidenceData(connection.database),
      repository: createLocalHealthEvidenceRepository(connection.database),
    };
    let observed: Parameters<typeof runRagConversationTurn>[0] | undefined;
    const toolEvent = {
      version: 1 as const,
      operationRunId: 'run',
      callId: 'call',
      toolName: 'memory',
      order: 1,
      status: 'completed' as const,
      inputSummary: { sourceKind: 'reviewed_memory' as const },
      sources: [],
    };
    const onToolEvent = jest.fn();
    const runner = jest.fn(
      async (
        options: Parameters<typeof runRagConversationTurn>[0],
        observer: Parameters<typeof runRagConversationTurn>[1],
      ) => {
        observed = options;
        observer?.onToolEvent?.(toolEvent);
        return { status: 'insufficient' as const };
      },
    ) as unknown as typeof runRagConversationTurn;
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => data,
      ragRunner: runner,
    });
    const context = {
      intent: 'visit-questions' as const,
      entryKey: 'local-entry',
      appointmentId: appointment.id,
    };
    await services.sendRagMessage(
      '수정한 진료 요청',
      [],
      undefined,
      { onToolEvent, retentionSession: { id: 'session', version: 0 } },
      context,
    );
    expect(onToolEvent).toHaveBeenCalledWith(toolEvent);
    expect(observed?.entryIntent).toBe('visit-questions');
    const item = observed?.targetVisitEvidence;
    expect(item?.content).toContain('선택된 진료');
    expect(item?.content).not.toContain('다른 진료');
    expect(JSON.stringify(item)).not.toContain(appointment.id);
    expect(JSON.stringify(item)).not.toContain(
      appointment.calendarEventIdentifier,
    );
    if (!item || !observed) throw new Error('Missing target evidence');
    expect(
      await observed.workflow.revalidateEvidence(
        [item],
        new AbortController().signal,
      ),
    ).toBe(true);
    await records.put('appointment', { ...appointment, status: 'cancelled' });
    expect(
      await observed.workflow.revalidateEvidence(
        [item],
        new AbortController().signal,
      ),
    ).toBe(false);
    const consentCalls = jest.mocked(consent.authorize).mock.calls.length;
    await expect(
      services.sendRagMessage('다시 질문', [], undefined, undefined, context),
    ).resolves.toEqual({ status: 'failure', kind: 'stale_evidence' });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(jest.mocked(consent.authorize)).toHaveBeenCalledTimes(consentCalls);
  } finally {
    connection.close();
  }
});
