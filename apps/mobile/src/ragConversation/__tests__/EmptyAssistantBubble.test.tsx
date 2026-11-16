import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ConversationMessage } from '../ConversationMessage';
import type { DisplayMessage } from '../conversationDisplayMessage';
import { conversationToolEventFixtures } from '../testSupport/conversationToolEventFixtures';

const props = { onOpenSource: jest.fn(), onLinkError: jest.fn() };
const opening = { callId: 'synthetic-opening', text: '먼저 살펴볼게요.' };
const message: DisplayMessage = {
  id: 1,
  role: 'assistant',
  content: '',
  streaming: true,
  initialResponse: opening,
};
const toolEvents = [conversationToolEventFixtures[0]!];

test('hidden tool activity cannot paint an empty final bubble after the opening', async () => {
  const view = await render(
    <ConversationMessage
      {...props}
      message={{ ...message, toolEvents }}
      showToolActivity={false}
    />,
  );
  expect(screen.getByText(opening.text)).toBeTruthy();
  expect(screen.queryByTestId('conversation-assistant-message')).toBeNull();
  await view.rerender(
    <ConversationMessage
      {...props}
      message={{
        ...message,
        toolEvents,
        content: '완료된 합성 답변',
        streaming: false,
      }}
      showToolActivity={false}
    />,
  );
  expect(
    screen.getByTestId('conversation-assistant-opening-message'),
  ).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-answer-body')).toHaveTextContent(
    '완료된 합성 답변',
  );
});

test.each([
  { incomplete: true },
  { visitQuestions: {} as NonNullable<DisplayMessage['visitQuestions']> },
  {
    citations: [
      { sourceKind: 'personal_record' },
    ] as unknown as DisplayMessage['citations'],
  },
])('non-visible metadata does not create a bubble: %p', async metadata => {
  await render(
    <ConversationMessage
      {...props}
      message={{ ...message, ...metadata }}
      showCitations={false}
    />,
  );
  expect(screen.getByText(opening.text)).toBeTruthy();
  expect(screen.queryByTestId('conversation-assistant-message')).toBeNull();
});

test('pending or stopped empty turns without an opening have no painted answer surface', async () => {
  const view = await render(
    <ConversationMessage
      {...props}
      message={{ ...message, initialResponse: undefined, toolEvents }}
      showToolActivity={false}
    />,
  );
  expect(screen.queryByTestId('conversation-assistant-message')).toBeNull();
  await view.rerender(
    <ConversationMessage
      {...props}
      message={{
        ...message,
        initialResponse: undefined,
        streaming: false,
        incomplete: true,
      }}
    />,
  );
  expect(screen.queryByTestId('conversation-assistant-message')).toBeNull();
});

test('visible failure, recovery action and rendered question content retain their answer surface', async () => {
  const view = await render(
    <ConversationMessage
      {...props}
      message={{ ...message, activity: '합성 복구 안내' }}
    />,
  );
  expect(
    screen.getByTestId('conversation-assistant-message'),
  ).toHaveTextContent('합성 복구 안내');
  await view.rerender(
    <ConversationMessage
      {...props}
      message={{
        ...message,
        incomplete: true,
        coldResume: { attempt: 1 },
        toolMessageId: 'synthetic-turn',
      }}
      onContinueCold={jest.fn()}
    />,
  );
  expect(screen.getByTestId('rag-conversation-cold-resume-1')).toBeTruthy();
  await view.rerender(
    <ConversationMessage
      {...props}
      message={{
        ...message,
        visitQuestions: {} as NonNullable<DisplayMessage['visitQuestions']>,
      }}
      renderVisitQuestions={() => <Text>합성 질문</Text>}
    />,
  );
  expect(
    screen.getByTestId('conversation-assistant-message'),
  ).toHaveTextContent('합성 질문');
});

test('visible tool records remain inspectable when their presentation is enabled', async () => {
  await render(
    <ConversationMessage {...props} message={{ ...message, toolEvents }} />,
  );
  expect(screen.getByTestId('conversation-assistant-message')).toBeTruthy();
});
