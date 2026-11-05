import type { ComponentProps } from 'react';
import type { ConversationScreen } from '../src/ragConversation/ConversationScreen';
import { evidenceVisualReference } from './evidenceVisualFixtures';

export const syntheticConversationAnswer =
  '합성 기록에는 복약, 활동과 수면 정보가 함께 있어요. 실제 증상의 원인을 확정한 답변은 아니에요.';

/** Explicit local UI fixture: no storage, retrieval engine, network or model is invoked. */
export const sendSyntheticConversation: ComponentProps<
  typeof ConversationScreen
>['onSend'] = async (question, _history, signal, observer) => {
  if (question === 'summary-probe') {
    // Synthetic result exercises the production card and navigation only, without model or database claims.
    const reference = {
      summaryId: 'synthetic-summary',
      window: {
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-11-01T00:00:00Z',
        timeZone: 'Asia/Seoul',
      },
    };
    const analysis = {
      presentation: 'symptom_summary' as const,
      incompleteEvidence: true,
      omittedUnsupportedContent: true,
      hypotheses: [
        {
          title: '합성 복약 기록',
          summary: '기록된 복약 한 건을 확인했어요.',
          uncertainty: '기록이 없는 날은 알 수 없어요.',
          missingData: [],
          supportingEvidence: [evidenceVisualReference],
          contraryEvidence: [],
        },
      ],
    };
    return {
      status: 'answer',
      answer: '합성 건강 요약이에요.',
      citations: [],
      healthSummary: {
        reference,
        analysis: { ...analysis, savedSummary: { status: 'failed' } },
      },
      retryHealthSummary: async () => ({
        reference,
        analysis: {
          ...analysis,
          savedSummary: {
            status: 'saved',
            id: reference.summaryId,
            createdAt: '2026-11-01T00:00:00Z',
            modelName: '합성 UI 검사',
          },
        },
      }),
    };
  }
  if (question.includes('failure')) return { status: 'unavailable' };
  observer?.onTaskStreamEvent?.({ type: 'started' });
  observer?.onTaskStreamEvent?.({
    type: 'text_delta',
    text: syntheticConversationAnswer,
  });
  if (question.includes('pending')) {
    // Stay pending until the real Stop action aborts; do not make timing determine the state.
    return new Promise(resolve => {
      if (signal?.aborted) resolve({ status: 'unavailable' });
      else
        signal?.addEventListener(
          'abort',
          () => resolve({ status: 'unavailable' }),
          { once: true },
        );
    });
  }
  return {
    status: 'answer',
    answer: syntheticConversationAnswer,
    citations: [evidenceVisualReference],
  };
};
