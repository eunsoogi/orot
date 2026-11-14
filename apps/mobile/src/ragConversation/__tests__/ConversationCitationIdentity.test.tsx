import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationMessage } from '../ConversationMessage';
import { ConversationSources } from '../ConversationSources';
import { reference } from '../../diseaseHypotheses/taskTestSupport';

// Repeated source content must still identify one native button, without changing its spoken label.
test('scopes repeated source controls by answer, summary section and occurrence', async () => {
  const onOpenSource = jest.fn();
  const props = { onOpenSource, onLinkError: jest.fn() };
  const section = {
    title: '합성 요약',
    summary: '합성 내용',
    uncertainty: '합성 자료만 사용',
    missingData: [],
    supportingEvidence: [reference],
    contraryEvidence: [reference],
  };
  const view = await render(
    <>
      <ConversationMessage
        {...props}
        message={{
          id: 2,
          role: 'assistant',
          content: '첫 답변',
          citations: [reference, reference],
          healthSummary: {
            reference: {
              summaryId: 'synthetic',
              window: {
                fromInclusive: '2026-10-01T00:00:00Z',
                toExclusive: '2026-11-01T00:00:00Z',
                timeZone: 'UTC',
              },
            },
            analysis: { hypotheses: [section, section] },
          },
        }}
      />
      <ConversationMessage
        {...props}
        message={{
          id: 4,
          role: 'assistant',
          content: '다음 답변',
          citations: [reference],
        }}
      />
    </>,
  );
  const ids = [
    'rag-conversation-message-2-citation-0',
    'rag-conversation-message-2-citation-1',
    'rag-conversation-message-2-summary-section-0-citation-0',
    'rag-conversation-message-2-summary-section-0-citation-1',
    'rag-conversation-message-2-summary-section-1-citation-0',
    'rag-conversation-message-2-summary-section-1-citation-1',
    'rag-conversation-message-4-citation-0',
  ];
  for (const id of ids) {
    const action = screen.getByTestId(id);
    expect(action.props.accessibilityRole).toBe('button');
    expect(action.props.accessibilityLabel).toMatch(/^원문 근거 열기/);
    await fireEvent.press(action);
  }
  expect(onOpenSource).toHaveBeenCalledTimes(ids.length);
  expect(
    onOpenSource.mock.calls.every(([source]) => source === reference),
  ).toBe(true);
  await view.unmount();
});

test('standalone source groups retain distinct identities across rerenders', async () => {
  const content = (
    <>
      <ConversationSources
        references={[reference]}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
      />
      <ConversationSources
        references={[reference]}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
      />
    </>
  );
  const view = await render(content);
  const ids = screen.getAllByRole('button').map(button => button.props.testID);
  expect(new Set(ids).size).toBe(2);
  expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
  await view.rerender(content);
  expect(
    screen.getAllByRole('button').map(button => button.props.testID),
  ).toEqual(ids);
  await view.unmount();
});
