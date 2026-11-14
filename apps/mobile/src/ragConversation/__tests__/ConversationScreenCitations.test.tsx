import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { ConversationScreen } from '../ConversationScreen';
import type { RagConversationOutcome } from '../service';

const earlierCitation: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'blood-pressure-record',
  sourceRevision: 'snapshot-1',
  evidenceId: 'blood-pressure-evidence',
  evidenceRevision: '1',
  locator: { kind: 'structured_record', recordId: 'blood-pressure-record' },
  effectiveTime: '2026-01-04T00:00:00Z',
  reviewState: 'reviewed',
};

const latestCitation: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'medication-record',
  sourceRevision: 'snapshot-2',
  evidenceId: 'medication-evidence',
  evidenceRevision: '1',
  locator: { kind: 'structured_record', recordId: 'medication-record' },
  effectiveTime: '2026-02-05T00:00:00Z',
  reviewState: 'reviewed',
};

const externalCitation: EvidenceReference = {
  sourceKind: 'external_medical',
  sourceId: 'europe-pmc',
  sourceRevision: 'retrieved:2026-10-11',
  evidenceId: 'MED:123',
  evidenceRevision: '1',
  locator: {
    title: 'Synthetic literature title',
    originalUrl: 'https://europepmc.org/article/MED/123',
    retrievedAt: '2026-10-11T00:00:00Z',
  },
  effectiveTime: null,
  reviewState: 'unknown',
};

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test('keeps citations with earlier and latest assistant answers and opens each source', async () => {
  const outcomes: RagConversationOutcome[] = [
    { status: 'answer', answer: '첫 답변', citations: [earlierCitation] },
    { status: 'answer', answer: '두 번째 답변', citations: [latestCitation] },
  ];
  const onOpenSource = jest.fn();
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={onOpenSource}
      onSend={jest.fn(async () => outcomes.shift()!)}
    />,
  );

  const input = screen.getByTestId('rag-conversation-input');
  for (const [question, answer] of [
    ['첫 질문', '첫 답변'],
    ['두 번째 질문', '두 번째 답변'],
  ]) {
    await fireEvent.changeText(input, question);
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    expect(await screen.findByText(answer)).toBeTruthy();
  }

  expect(screen.queryByTestId('rag-conversation-evidence-panel')).toBeNull();
  expect(screen.queryByTestId('rag-conversation-evidence-empty')).toBeNull();
  // Transcript order keeps each source action associated with its own answer.
  const sourceActions = screen.getAllByLabelText(/원문 근거 열기/u);
  expect(sourceActions).toHaveLength(2);
  expect(sourceActions.map(action => action.props.testID)).toEqual([
    'rag-conversation-message-2-citation-0',
    'rag-conversation-message-4-citation-0',
  ]);
  await fireEvent.press(sourceActions[0]);
  await fireEvent.press(sourceActions[1]);
  expect(onOpenSource).toHaveBeenNthCalledWith(1, earlierCitation);
  expect(onOpenSource).toHaveBeenNthCalledWith(2, latestCitation);
});

test('shows a recoverable error when an inline external source cannot open', async () => {
  jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('No browser'));
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={jest.fn(async () => ({
        status: 'answer' as const,
        answer: '답변',
        citations: [externalCitation],
      }))}
    />,
  );

  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '문헌 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(await screen.findByText('답변')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(/원문 근거 열기/u));
  expect(await screen.findByTestId('rag-conversation-error')).toHaveTextContent(
    '출처를 열지 못했어요. 다시 시도해 주세요.',
  );
});
