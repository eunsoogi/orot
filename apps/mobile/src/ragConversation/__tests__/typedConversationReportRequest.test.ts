import {
  typedConversationReportIntent,
  withTypedComposerReport,
} from '../typedConversationReportRequest';
import type { ConversationEntryContext } from '../../aiFeatures/integration/conversationIntent';
import { requestsPossibilityReport } from '../structuredPossibilityReport';
import { t } from '../../i18n';

test.each([
  [t('conversationActions.possibilities'), 'possibilities'],
  ['질병 가능성 보고서를 만들어 주세요.', 'possibilities'],
  ['검사 결과 중심으로 질병 가능성 보고서를 작성해 줘.', 'possibilities'],
  [t('conversationIntent.healthSummary'), 'health-summary'],
  ['내 건강 정보를 요약해줘', 'health-summary'],
  ['최근 건강 기록을 수면 위주로 요약해 줘.', 'health-summary'],
])('accepts explicit typed report/summary commands: %s', (text, intent) => {
  expect(typedConversationReportIntent(text!)).toBe(intent);
});

test.each([
  '식사 후 두통이 생길 가능성이 있나요?',
  '질병 가능성 보고서가 무슨 뜻이에요?',
  '지난 질병 가능성 보고서를 설명해줘.',
  '내 건강 정보를 요약하지 말아줘.',
  '이 사진에 나온 건강 정보를 요약해줘.',
  '건강 정보를 요약해줘. 일일 보고서도 만들어줘.',
  '“질병 가능성 보고서를 만들어 주세요.”라고 적을까요?',
])(
  'does not take contextual prose or ambiguous commands as a template: %s',
  text => {
    expect(typedConversationReportIntent(text)).toBeUndefined();
  },
);

test.each([
  [
    { intent: 'visit-questions', entryKey: 'visit', appointmentId: 'exact' },
    false,
  ],
  [{ intent: 'daily-report', entryKey: 'active-report' }, false],
  [{ intent: 'medical-literature', entryKey: 'medical' }, false],
  [undefined, true],
] as const)(
  'forwards exact selected context and attachment unchanged: %j',
  async (context, photo) => {
    const send = jest.fn(async () => ({ status: 'no_evidence' as const }));
    const observer = {
      inputOrigin: 'composer',
      ...(photo ? { photoInput: {} } : {}),
    } as unknown as Parameters<ReturnType<typeof withTypedComposerReport>>[3];
    const question = '질병 가능성 보고서를 만들어 주세요.';
    await withTypedComposerReport(send)(
      question,
      [],
      undefined,
      observer,
      context as ConversationEntryContext | undefined,
    );
    expect(send.mock.calls).toEqual([
      context
        ? [question, [], undefined, observer, context]
        : [question, [], undefined, observer],
    ]);
  },
);

test('the new explicit marker cannot reinterpret a historical v15 ordinary follow-up', () => {
  const request = '질병 가능성 보고서를 만들어 주세요.';
  const context = { intent: 'possibilities', authoredCurrentRequest: true };
  expect(requestsPossibilityReport({ request, context })).toBe(false);
  expect(
    requestsPossibilityReport({
      request,
      context: { ...context, typedPossibilityReport: true },
    }),
  ).toBe(true);
  expect(
    requestsPossibilityReport({
      request,
      context: {
        ...context,
        intent: 'conversation',
        typedPossibilityReport: true,
      },
    }),
  ).toBe(false);
});
