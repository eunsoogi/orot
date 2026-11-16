import { appointment } from '../../agent/visitQuestions/testing/persistenceFixtures';
import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { ConversationMessage } from '../ConversationMessage';

// Relative constraints keep the opposite-side gap as the measured content column changes.
test('uses relative opposite message lanes without fixed-width text', async () => {
  await render(
    <View style={{ width: 240 }}>
      <ConversationMessage
        message={{ id: 1, role: 'user', content: '합성 질문 '.repeat(20) }}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
      />
      <ConversationMessage
        message={{
          id: 2,
          role: 'assistant',
          content: '합성 답변 '.repeat(20),
          streaming: true,
        }}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
      />
    </View>,
  );
  expect(screen.getByTestId('conversation-user-message')).toHaveStyle({
    alignSelf: 'flex-end',
    maxWidth: '85%',
  });
  expect(screen.getByTestId('conversation-assistant-message')).toHaveStyle({
    alignSelf: 'flex-start',
    maxWidth: '85%',
  });
  expect(screen.getByTestId('rag-conversation-stream')).toHaveTextContent(
    /합성 답변/,
  );
});

// Questions are assistant replies too; only their inner spacing is compact.
test('keeps final questions in the assistant lane with compact inner padding', async () => {
  await render(
    <ConversationMessage
      message={{
        id: 3,
        role: 'assistant',
        content: '합성 안내 문장은 일반 답변 여백을 유지합니다.',
        visitQuestions: {
          appointment,
          review: {
            ownerKey: 'synthetic',
            items: [],
            caveats: [],
            expectedSavedQuestions: [],
          },
          validateSource: async () => true,
        },
      }}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      renderVisitQuestions={() => <View testID="synthetic-question-list" />}
    />,
  );
  expect(screen.getByTestId('conversation-assistant-message')).toHaveStyle({
    alignSelf: 'flex-start',
    maxWidth: '85%',
    width: '85%',
  });
  expect(screen.getByTestId('conversation-message-body')).toHaveStyle({
    padding: 18,
    gap: 14,
  });
  expect(screen.getByTestId('conversation-question-region')).toHaveStyle({
    marginHorizontal: -10,
  });
  expect(screen.getByTestId('rag-conversation-answer-body')).toHaveTextContent(
    '합성 안내 문장은 일반 답변 여백을 유지합니다.',
  );
  expect(screen.getByTestId('synthetic-question-list')).toBeTruthy();
});

// A question-specific inset must never reach ordinary assistant prose or user bubbles.
test('preserves ordinary answer padding independently from the compact question region', async () => {
  await render(
    <ConversationMessage
      message={{ id: 4, role: 'assistant', content: '합성 일반 답변' }}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
  expect(screen.getByTestId('conversation-message-body')).toHaveStyle({
    padding: 18,
    gap: 14,
  });
  expect(screen.queryByTestId('conversation-question-region')).toBeNull();
});

it.each([undefined, () => null])(
  'does not add an empty region when questions have no renderer output',
  async renderVisitQuestions => {
    await render(
      <ConversationMessage
        message={{
          id: 5,
          role: 'assistant',
          content: '합성 안내',
          visitQuestions: {
            appointment,
            review: {
              ownerKey: 'synthetic',
              items: [],
              caveats: [],
              expectedSavedQuestions: [],
            },
            validateSource: async () => true,
          },
        }}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
        renderVisitQuestions={renderVisitQuestions}
      />,
    );
    expect(screen.queryByTestId('conversation-question-region')).toBeNull();
  },
);
