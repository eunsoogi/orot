import { dailyReportConversationFailure } from '../dailyReportConversationFailure';
import { getRagConversationFailureCopy } from '../../../ragConversation/copy';
import { createEmptyConversation } from '../../../ragConversation/conversationEmptySession';
import { restoreFailedPrompt } from '../../../ragConversation/conversationFailedPrompt';
import type { ConversationSession } from '../../../ragConversation/conversationSessionTypes';
import { dailyReportFailureMessage } from '../dailyReportFailurePresentation';

test('unavailable day or permitted-scope evidence is not described as a failed database read', () => {
  const outcome = dailyReportConversationFailure('source_unavailable');
  expect(outcome).toEqual({
    status: 'failure',
    kind: 'daily_report_sources_unavailable',
  });
  if (outcome.status !== 'failure') throw new Error('Expected failure');
  expect(getRagConversationFailureCopy(outcome.kind)).toBe(
    '이 날짜에서 보고서에 사용할 기록을 찾지 못했어요. 기록 상태를 확인한 뒤 다시 요약해 주세요.',
  );
  for (const code of ['source_read_failed', 'report_read_failed'] as const) {
    expect(dailyReportConversationFailure(code)).toEqual({
      status: 'failure',
      kind: 'retrieval_failed',
    });
  }
});

test.each(['', '편집 중인 초안'])(
  'a post-dispatch check offers manual retry without replacing a draft: %s',
  draft => {
    const question = '오늘의 일일 보고서를 만들어 주세요.';
    const message = {
      id: 2,
      role: 'user' as const,
      content: question,
      deliveryPending: true,
    };
    let session: ConversationSession = {
      ...createEmptyConversation(1),
      draft,
      messages: [message],
    };
    const outcome = dailyReportConversationFailure(
      'source_unconfirmed_after_dispatch',
    );
    expect(outcome).toEqual({
      status: 'failure',
      kind: 'daily_report_retry_current',
    });
    if (outcome.status !== 'failure') throw new Error('Expected failure');
    const copy = getRagConversationFailureCopy(outcome.kind);
    expect(copy).toBe(
      '보고서가 현재 기록과 맞는지 확인하지 못해 표시하지 않았어요. 현재 기록으로 다시 요청할 수 있어요.',
    );
    expect(
      dailyReportFailureMessage('source_unconfirmed_after_dispatch', false),
    ).toBe(copy);
    expect(dailyReportConversationFailure('source_revision_changed')).toEqual({
      status: 'failure',
      kind: 'stale_evidence',
    });
    restoreFailedPrompt(
      () => session,
      (_id, patch) => {
        session = { ...session, ...patch };
      },
      1,
      question,
      message.id,
      copy,
    );
    expect(session.draft).toBe(draft || question);
    expect(session.messages).toEqual([
      { ...message, deliveryPending: false, failed: true },
    ]);
    expect(session.error).toBe(copy);
  },
);
