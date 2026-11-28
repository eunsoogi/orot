import { fireEvent, screen } from '@testing-library/react-native';
import {
  providerSuccess,
  type LanguageModelRequest,
  type JsonObject,
} from '@orot/model-runtime';
import { apple } from '../../aiFeatures/integration/featureServiceFixtures';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';

const original = '방금 요약한 건강 정보에서 기억할 만한 걸 기억해줘';

export const healthSummarySectionCases = [
  { mode: 'selected', question: original },
  {
    mode: 'selected',
    question: '아까 정리해 준 내용 중 다음에도 볼 만한 대목 하나만 남겨 줄래?',
  },
  {
    mode: 'selected',
    question:
      'Could you set aside one useful bit from that recap for next time?',
  },
  { mode: 'ordinary', question: '앞에 정리한 내용은 무슨 뜻이야?' },
  {
    mode: 'ordinary',
    question: 'Which part of that summary should I review first?',
  },
  {
    mode: 'ordinary',
    question: '그 요약은 보관하지 말고 내용만 조금 더 설명해 줘.',
  },
  {
    mode: 'whole-summary',
    question: 'Keep a link to the entire health summary for later, please.',
  },
  { mode: 'remote', question: original },
  { mode: 'no-selection-proof', question: original },
  { mode: 'malformed-tool', question: original },
  { mode: 'protection-lost', question: original },
  { mode: 'selection-before', question: original },
  { mode: 'selection-after', question: original },
  { mode: 'selection-during-classifier', question: original },
  { mode: 'stop-during-classifier', question: original },
] as const;

export const replaceSelection = () =>
  providerSelectionStore.save({
    providerId: apple.provider.id,
    modelId: 'different-synthetic-model',
  });

export function healthSummarySectionModel(
  { mode, question }: (typeof healthSummarySectionCases)[number],
  loseProtection: () => void,
  hold: Promise<void>,
) {
  return jest.fn(async (request: LanguageModelRequest) => {
    const safe = JSON.stringify(request);
    const tool = request.tools?.[0]?.name;
    expect(safe).not.toContain('owned-summary');
    expect(safe).not.toContain('Earlier synthetic prompt');
    const classifier = tool === 'classify-memory-request';
    if (tool === 'propose_conversation_template')
      return providerSuccess({
        text: '',
        finishReason: 'tool_calls' as const,
        toolCalls: [
          {
            id: 'ordinary-stock-proposal',
            name: tool,
            arguments: { intent: 'ordinary' },
          },
        ],
      });
    if (classifier) {
      expect(request.messages[1]).toEqual({ role: 'user', content: question });
      expect(safe).not.toMatch(
        /Synthetic chosen content|Synthetic chosen section/,
      );
      if (mode === 'selection-during-classifier') await replaceSelection();
      if (mode === 'stop-during-classifier') await hold;
    } else {
      expect(request.tools?.map(row => row.name)).toEqual([
        'remember-health-summary-section',
      ]);
      expect(safe).toContain('Synthetic chosen content');
      if (mode === 'protection-lost') loseProtection();
      if (mode === 'selection-after') await replaceSelection();
    }
    const response: JsonObject = classifier
      ? {
          intent:
            mode === 'ordinary' || mode === 'whole-summary' ? mode : 'section',
        }
      : {
          slot: 'section_2',
          ...(mode === 'malformed-tool'
            ? { invented: 'Skip source check' }
            : {}),
        };
    return providerSuccess({
      text: 'Untrusted model prose',
      finishReason: 'tool_calls' as const,
      toolCalls: [{ id: 'local-only', name: tool ?? '', arguments: response }],
    });
  });
}

export async function submitHealthSummaryMemoryMessage(question: string) {
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    question,
  );
  await fireEvent(screen.getByTestId('rag-conversation-send'), 'composerPress');
}

export function expectedHealthSummaryMemoryTools(
  mode: (typeof healthSummarySectionCases)[number]['mode'],
) {
  if (mode === 'remote' || mode === 'no-selection-proof') return [];
  if (mode === 'ordinary')
    return ['classify-memory-request', 'propose_conversation_template'];
  if (
    mode === 'whole-summary' ||
    mode === 'selection-before' ||
    mode === 'selection-during-classifier'
  )
    return ['classify-memory-request'];
  return ['classify-memory-request', 'remember-health-summary-section'];
}
