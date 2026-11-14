import type { ComponentProps } from 'react';
import type {
  ConversationToolEvent,
  ToolSourceReference,
} from '@orot/agent-runtime';
import { LocalEvidenceReferenceRegistry } from '../src/aiFeatures/integration/evidenceRegistry';
import type { ResolveConversationToolSource } from '../src/ragConversation/ConversationToolEventSources';
import type { ConversationSessionOptions } from '../src/ragConversation/conversationSessionTypes';
import { conversationToolEventFixtures } from '../src/ragConversation/testSupport/conversationToolEventFixtures';
import type { ConversationScreen } from '../src/ragConversation/ConversationScreen';
import {
  evidenceVisualRecords,
  evidenceVisualReference,
} from './evidenceVisualFixtures';

export const syntheticConversationAnswer =
  '합성 기록에는 복약, 활동과 수면 정보가 함께 있어요. 실제 증상의 원인을 확정한 답변은 아니에요.';

const completedToolEvent = conversationToolEventFixtures[0]!;
const failedToolEvent = conversationToolEventFixtures[1]!;
const interruptedToolEvent = conversationToolEventFixtures[2]!;
const syntheticToolRunId = 'conversation-visual-tool-events';
const syntheticToolSourceSessionId = 'conversation-visual-tool-session';
const visualSourceRegistry = new LocalEvidenceReferenceRegistry();
const visualToolSource = visualSourceRegistry.add({
  reference: evidenceVisualReference,
  content: '합성 도구 출처',
  validate: async () => true,
  readSource: async () => ({
    status: 'available',
    document: {
      sourceKind: 'personal_record',
      records: [evidenceVisualRecords.medication],
    },
  }),
});
const toolSourceReference: ToolSourceReference = {
  sourceKind: visualToolSource.sourceKind,
  sourceId: visualToolSource.sourceId,
  sourceRevision: visualToolSource.sourceRevision,
  evidenceId: visualToolSource.evidenceId,
  evidenceRevision: visualToolSource.evidenceRevision,
};

/** Re-resolve one fixture alias through the production registry for the native source-navigation journey. */
export const resolveConversationVisualToolSource: ResolveConversationToolSource =
  (reference, signal, scope) => {
    if (
      !scope ||
      scope.sessionId !== syntheticToolSourceSessionId ||
      scope.operationRunId !== syntheticToolRunId ||
      scope.callId !== 'tool-1'
    )
      return Promise.resolve(undefined);
    return visualSourceRegistry.resolveToolSource(reference, signal, scope);
  };

/** Stable test-only identities make the synthetic source action available without initializing persistence. */
const visualSessionRetention: NonNullable<
  ConversationSessionOptions['retention']
> = {
  activeIdentity: () => syntheticToolSourceSessionId,
  activeLease: () => ({ id: syntheticToolSourceSessionId, version: 0 }),
  invalidate() {},
  prepareRemoval() {},
  async resumeIfActive() {
    return syntheticToolSourceSessionId;
  },
  async attachExisting() {},
  async beginTurn(_id, signal) {
    if (signal.aborted) throw new Error('Conversation is unavailable.');
    return {
      toolMessageId: 'conversation-visual-tool-message',
      async startRequest() {},
      async interruptRequest() {},
      async invalidatePreview() {
        return 0;
      },
      async preparePreview() {
        return false;
      },
      async writePreview() {
        return false;
      },
      async recordToolEvent() {},
      async save() {},
      defer() {},
      canRetry: () => false,
      hasPending: () => false,
      suspend() {},
      resume() {},
      async retry() {},
      discardRetry() {},
    };
  },
  async hide() {
    return null;
  },
  async undo() {},
  async finalize() {},
};

/** General history journeys stay memory-only so their delete and undo path is preserved. */
export const conversationVisualSessionOptions: ConversationSessionOptions = {};

/** Only the tool-source journey needs this retained identity to resolve its synthetic source. */
export const conversationVisualToolSourceSessionOptions: ConversationSessionOptions =
  {
    retention: visualSessionRetention,
  };

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
    resultSummary: { referenceCount: 1 },
    sources: [toolSourceReference],
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
  // Native autocapitalization may change fixture keywords on commit, not their intended control state.
  const controlQuestion = question.toLowerCase();
  if (controlQuestion.includes('failure')) return { status: 'unavailable' };
  observer?.onTaskStreamEvent?.({ type: 'started' });
  observer?.onTaskStreamEvent?.({
    type: 'text_delta',
    text: syntheticConversationAnswer,
  });
  if (controlQuestion.includes('pending')) {
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
