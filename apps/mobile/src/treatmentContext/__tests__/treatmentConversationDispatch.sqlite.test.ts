import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { treatmentSafetyKo } from '../../i18n/treatmentSafety';
import { createConversationSessions } from '../../ragConversation/conversationSessions';
import { sendExplicitTreatmentMessage } from '../../ragConversation/conversationVisitDispatch';
import type { TreatmentExplanationRequest } from '../interfaces';
import { treatmentConversationSender } from '../treatmentConversationSender';

const safetyInput = {
  population: 'adult_not_pregnant' as const,
  readingContext: 'current_measurement' as const,
  readings: [
    {
      systolicMmHg: 120,
      diastolicMmHg: 80,
      unit: 'mmHg' as const,
      measuredAt: '2026-10-05T00:00:00.000Z',
      source: 'synthetic',
    },
  ],
  symptomAssessment: { status: 'no_new_or_concerning_symptoms' as const },
};

test('explicit treatment action reaches a validated conversation answer without provider or search', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const sessions = createConversationSessions();
  try {
    await runMigrations(db.database);
    const authorize = jest.fn();
    const search = jest.fn();
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
      inferenceConsent: { authorize },
      publicEvidenceTool: { search },
    } as unknown as TreatmentExplanationRequest;
    sessions.setDraft(1, '치료 선택지');
    await sendExplicitTreatmentMessage(
      sessions,
      1,
      treatmentConversationSender({
        database: db.database,
        request,
        action: { kind: 'request', selection: { kind: 'general_options' } },
        safetyInput,
      }),
    );
    expect(sessions.getSnapshot().sessions[0]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: treatmentSafetyKo['treatmentSafety.generalOptions'],
          completion: 'partial',
          citations: [],
        }),
      ]),
    );
    expect(authorize).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(
      await treatmentConversationSender({
        database: db.database,
        request,
        action: { kind: 'request', selection: { kind: 'general_options' } },
        safetyInput: {},
      })('Synthetic', [], new AbortController().signal),
    ).toEqual({
      status: 'answer',
      answer: treatmentSafetyKo['treatmentSafety.inputRequired'],
      citations: [],
    });
    const urgent = await treatmentConversationSender({
      database: db.database,
      request,
      action: { kind: 'request', selection: { kind: 'general_options' } },
      safetyInput: {
        ...safetyInput,
        readings: [
          {
            ...safetyInput.readings[0]!,
            systolicMmHg: 190,
            diastolicMmHg: 120,
          },
        ],
        symptomAssessment: { status: 'warning_signs', signs: ['chest_pain'] },
      },
    })('Synthetic', [], new AbortController().signal);
    expect(urgent).toEqual({
      status: 'answer',
      answer: treatmentSafetyKo['treatmentSafety.emergency'],
      citations: [],
    });
    sessions.setDraft(1, '지원하지 않는 요청');
    await sendExplicitTreatmentMessage(
      sessions,
      1,
      treatmentConversationSender({
        database: db.database,
        request,
        action: { kind: 'request', selection: { kind: 'condition', index: 4 } },
        safetyInput,
      }),
    );
    expect(
      sessions
        .getSnapshot()
        .sessions[0]?.messages.filter(message => message.role === 'assistant'),
    ).toHaveLength(1);
  } finally {
    sessions.dispose();
    db.close();
  }
});
