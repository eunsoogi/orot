import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationScreenProps } from '../ConversationScreenProps';
import { conversationChoiceActions } from '../selectConversationChoice';
import { conversationWorkflowContext } from '../conversationWorkflowContext';
import type { RagConversationRunOptions } from '../service';
import { ragConversationTask } from '../task';
import { t } from '../../i18n';
import { scriptedTemplateSender } from '../testSupport/conversationTemplateFixture';
import {
  answer,
  input,
} from '../testSupport/structuredPossibilityReportFixture';

const typedPossibilities = '질병 가능성 보고서를 근거 중심으로 만들어 줘.';
const typedSummary = '최근 건강 기록을 수면 위주로 요약해 줘.';
const ordinary = '식사 후 두통이 생길 가능성이 있나요?';

const healthSummary = {
  reference: {
    summaryId: 'one',
    window: {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-05T00:00:00Z',
      timeZone: 'UTC',
    },
  },
  analysis: {
    hypotheses: [
      {
        title: '수면',
        summary: '합성 수면 요약',
        uncertainty: '',
        missingData: [],
        supportingEvidence: [],
        contraryEvidence: [],
      },
    ],
  },
};

test.each([
  ['possibilities', typedPossibilities, 'rag-conversation-answer-body'],
  ['health-summary', typedSummary, 'health-summary-card'],
  ['ordinary', ordinary, 'rag-conversation-answer-body'],
  [
    'ordinary',
    t('conversationActions.possibilities'),
    'rag-conversation-answer-body',
  ],
  [
    'shortcut',
    t('conversationIntent.possibilities'),
    'rag-conversation-answer-body',
  ],
] as const)(
  'routes an actual composer/shortcut to its existing template: %s',
  async (mode, question, marker) => {
    type Send = ConversationScreenProps['onSend'];
    const task = jest.fn();
    const send = jest.fn<ReturnType<Send>, Parameters<Send>>(
      async (request, previousMessages, _signal, observer, context) => {
        if (context?.intent === 'health-summary')
          return {
            status: 'answer',
            answer: '합성 건강 기록 요약',
            citations: [],
            healthSummary,
          };
        const runOptions = {
          entryIntent: context?.intent,
          previousMessages,
          authoredCurrentRequest: observer?.inputOrigin === 'composer',
          typedPossibilityReport: context?.typedPossibilityReport,
          explicitPossibilityChoice: observer?.inputOrigin === 'shortcut',
        } as RagConversationRunOptions;
        const args = {
          ...input,
          request,
          context: conversationWorkflowContext(runOptions),
        };
        const schema = ragConversationTask.createResultSchema!(args);
        task(args, schema);
        if (context?.intent !== 'possibilities')
          return { status: 'answer', answer: '합성 일반 응답', citations: [] };
        const validated = ragConversationTask.validateResult(
          { answerKind: 'grounded', answer },
          args,
        );
        if (validated.status !== 'valid')
          return { status: 'failure', kind: 'validation_failed' };
        return {
          status: 'answer',
          answer: validated.value.answer,
          citations: [],
        };
      },
    );
    function Host() {
      const store = useConversationSessions();
      const choices = conversationChoiceActions(store, () => true);
      return (
        <ConversationScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={scriptedTemplateSender(send, () =>
            mode === 'health-summary' || mode === 'possibilities'
              ? mode
              : 'ordinary',
          )}
          retainedActions={{ possibilities: choices.onOpenDiseaseHypotheses }}
        />
      );
    }
    await render(
      <ConversationSessionsProvider>
        <Host />
      </ConversationSessionsProvider>,
    );
    if (mode === 'shortcut')
      await fireEvent.press(
        screen.getByTestId('conversation-open-possibilities'),
      );
    else {
      await fireEvent.changeText(
        screen.getByTestId('rag-conversation-input'),
        question,
      );
      await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    }
    await screen.findByTestId(marker);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe(question);
    expect(send.mock.calls[0]?.[3]?.inputOrigin).toBe(
      mode === 'shortcut' ? 'shortcut' : 'composer',
    );
    if (mode === 'health-summary') {
      expect(send.mock.calls[0]?.[4]?.intent).toBe('health-summary');
      expect(screen.getByText('합성 수면 요약')).toBeTruthy();
      expect(task).not.toHaveBeenCalled();
    } else if (mode === 'ordinary') {
      expect(screen.getByText('합성 일반 응답')).toBeTruthy();
      expect(task.mock.calls[0]?.[1]).not.toHaveProperty(
        'properties.answer.anyOf',
      );
    } else {
      expect(send.mock.calls[0]?.[4]?.intent).toBe('possibilities');
      expect(task.mock.calls[0]?.[1]).toHaveProperty('properties.answer.anyOf');
      expect(screen.getByText(answer.observations)).toBeTruthy();
    }
  },
);
