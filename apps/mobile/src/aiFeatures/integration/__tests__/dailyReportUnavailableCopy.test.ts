import { dailyReportConversationFailure } from '../dailyReportConversationFailure';
import { getRagConversationFailureCopy } from '../../../ragConversation/copy';

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
