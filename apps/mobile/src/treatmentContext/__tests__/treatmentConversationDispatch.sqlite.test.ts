import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { treatmentSafetyKo } from '../../i18n/treatmentSafety';
import { createConversationSessions } from '../../ragConversation/conversationSessions';
import { sendExplicitTreatmentMessage } from '../../ragConversation/conversationVisitDispatch';
import type { TreatmentExplanationRequest } from '../interfaces';
import { treatmentConversationSender } from '../treatmentConversationSender';

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
        actions: [],
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
    const urgent = await treatmentConversationSender({
      database: db.database,
      request,
      action: { kind: 'request', selection: { kind: 'general_options' } },
      actions: ['seek_immediate_emergency_help'],
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
        actions: [],
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
