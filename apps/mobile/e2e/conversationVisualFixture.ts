import type { ComponentProps } from 'react';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { conversationToolEventFixtures } from '../src/ragConversation/testSupport/conversationToolEventFixtures';
import type { ConversationScreen } from '../src/ragConversation/ConversationScreen';
import { evidenceVisualReference } from './evidenceVisualFixtures';

export const syntheticConversationAnswer =
  '합성 기록에는 복약, 활동과 수면 정보가 함께 있어요. 실제 증상의 원인을 확정한 답변은 아니에요.';

const completedToolEvent = conversationToolEventFixtures[0]!;
const failedToolEvent = conversationToolEventFixtures[1]!;
const interruptedToolEvent = conversationToolEventFixtures[2]!;
const syntheticToolRunId = 'conversation-visual-tool-events';

/** Keep every rendered state synthetic while preserving retry identity across two runs. */
const syntheticToolEvents: readonly ConversationToolEvent[] = [
  {
    version: 1,
    operationRunId: syntheticToolRunId,
    callId: 'tool-running',
    toolName: completedToolEvent.toolName,
    order: 1,
    status: 'started',
    inputSummary: completedToolEvent.inputSummary,
    sources: [],
  },
  {
    ...completedToolEvent,
    operationRunId: syntheticToolRunId,
    callId: 'tool-1',
    order: 2,
    resultSummary: { referenceCount: 0 },
    sources: [],
  },
  {
    ...failedToolEvent,
    operationRunId: syntheticToolRunId,
    callId: 'tool-2',
    order: 3,
    sources: [],
  },
  {
    ...failedToolEvent,
    operationRunId: syntheticToolRunId,
    callId: 'tool-cancelled',
    order: 4,
    status: 'cancelled',
    sources: [],
  },
  {
    ...interruptedToolEvent,
    operationRunId: 'conversation-visual-tool-retry',
    callId: 'tool-1',
    sources: [],
  },
];

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
  if (question === 'tool-events-probe') {
    // Exercise the production observer with summary-only events; this path never calls a model or persistence layer.
    for (const event of syntheticToolEvents) observer?.onToolEvent?.(event);
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
