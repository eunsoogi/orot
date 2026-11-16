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
        content: '',
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
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 8,
  });
  expect(screen.getByTestId('synthetic-question-list')).toBeTruthy();
});
