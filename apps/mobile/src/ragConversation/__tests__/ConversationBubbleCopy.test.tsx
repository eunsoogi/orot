import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';
import { ConversationBubbleEntranceContext } from '../ConversationBubbleEntrance';
import { createConversationBubbleEntrances } from '../conversationBubbleEntrances';
import { ConversationMessage } from '../ConversationMessage';
import { conversationBubbleCopyText } from '../conversationBubbleCopyText';
import { possibilityReportTemplate } from '../conversationReportTemplate';

jest.mock('../ConversationBubbleCopyHost', () => ({
  ConversationBubbleCopyHost: require('react-native').View,
  AnimatedConversationBubbleCopyHost: require('react-native').Animated.View,
}));

const actions = { onOpenSource: jest.fn(), onLinkError: jest.fn() };
test.each(['user', 'assistant'] as const)(
  'only the visible %s body is configured; retain the same bubble when authority changes',
  async role => {
    const id = role === 'user' ? 1 : -2;
    const message = {
      role,
      id,
      content: 'Synthetic visible words',
      photoAttached: true,
      previousOutputs: ['Synthetic older body'],
      toolMessageId: 'never expose a retained identity',
      ...(role === 'assistant'
        ? {
            savedHistoryDisplayOnly: true as const,
            restoredHistory: true as const,
          }
        : {}),
    };
    const type =
      role === 'user'
        ? 'conversation-user-message'
        : 'conversation-message-body';
    const view = await render(
      <ConversationMessage
        {...actions}
        message={message}
        copyScope={{ sessionId: 9, allowed: true }}
      />,
    );
    const original = screen.getByTestId(type);
    expect(original.props.copyOwner).toBe(`9:${id}`);
    expect(original.props.copyLabel).toBe('복사');
    expect(original.props.copyText).toBe('Synthetic visible words');
    if (role === 'assistant') {
      expect(
        screen.getByTestId('conversation-assistant-message').props.copyText,
      ).toBeUndefined();
      expect(
        within(original).getByText('Synthetic visible words'),
      ).toBeVisible();
    }
    expect(actions.onOpenSource).not.toHaveBeenCalled();
    await view.rerender(
      <ConversationMessage
        {...actions}
        message={message}
        copyScope={{ sessionId: 9, allowed: false }}
      />,
    );
    const cleared = screen.getByTestId(type);
    expect(cleared).toBe(original);
    expect(cleared.props.copyText).toBeUndefined();
    expect(screen.getByText('Synthetic visible words')).toBeTruthy();
  },
);

test('copies a separately visible reviewed opening only on its own bubble', async () => {
  await render(
    <ConversationMessage
      {...actions}
      copyScope={{ sessionId: 7, allowed: true }}
      message={{
        id: -4,
        role: 'assistant',
        content: 'Synthetic answer',
        initialResponse: {
          callId: 'synthetic',
          text: 'Synthetic reviewed opening',
        },
      }}
    />,
  );
  const opening = screen.getByTestId('conversation-opening-body');
  expect(opening.props.copyOwner).toBe('7:-4:opening');
  expect(opening.props.copyText).toBe('Synthetic reviewed opening');
  expect(screen.getByTestId('conversation-message-body').props.copyText).toBe(
    'Synthetic answer',
  );
  expect(
    screen.getByTestId('conversation-assistant-opening-message').props.copyText,
  ).toBeUndefined();
});

test('formats visible report headings and refuses unavailable or not-yet-admitted text', () => {
  const template = possibilityReportTemplate();
  const message = {
    role: 'assistant' as const,
    id: -2,
    content: [
      `# ${template.title}`,
      ...template.sections.map(
        (title, index) => `## ${title}\nSynthetic section ${index}`,
      ),
    ].join('\n'),
  };
  expect(conversationBubbleCopyText(message)).toBe(
    [
      template.title,
      ...template.sections.map(
        (title, index) => `${title}\nSynthetic section ${index}`,
      ),
    ].join('\n\n'),
  );
  for (const denied of [
    { streaming: true },
    { historyUnavailable: true },
    { localChoicePending: true },
    { content: '   ' },
  ] as const)
    expect(
      conversationBubbleCopyText({ ...message, ...denied }),
    ).toBeUndefined();
});

test('a citation remains an independent tap and its URL is not a copy payload', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  try {
    await render(
      <ConversationMessage
        {...actions}
        showCitations
        copyScope={{ sessionId: 6, allowed: true }}
        message={{
          id: -9,
          role: 'assistant',
          content: 'Visible synthetic answer',
          savedHistoryDisplayOnly: true,
          citations: [
            {
              sourceKind: 'external_medical',
              sourceId: 'europe-pmc',
              sourceRevision: 'retrieved:2026-10-11',
              evidenceId: 'MED:123',
              evidenceRevision: '1',
              reviewState: 'unknown',
              effectiveTime: '2026-01-01',
              locator: {
                title: 'Synthetic literature title',
                originalUrl: 'https://europepmc.org/article/MED/123',
                retrievedAt: '2026-10-11T00:00:00Z',
              },
            },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('conversation-message-body').props.copyText).toBe(
      'Visible synthetic answer',
    );
    expect(screen.getByText('Visible synthetic answer').props.selectable).toBe(
      false,
    );
    expect(open).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText(/원문 근거 열기/));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://europepmc.org/article/MED/123');
  } finally {
    open.mockRestore();
  }
});

test.each(['live', 'restored', 'pending shortcut', 'without copy'] as const)(
  'the %s outgoing bubble keeps its padding on the standard body view',
  async mode => {
    const content = 'First synthetic line\nSecond synthetic line';
    const receipts = createConversationBubbleEntrances();
    const copyScope =
      mode === 'without copy' ? undefined : { sessionId: 9, allowed: true };
    await render(
      <ConversationBubbleEntranceContext.Provider
        value={{ receipts, motionAllowed: false }}
      >
        <ConversationMessage
          {...actions}
          message={{
            id: 1,
            role: 'user',
            content,
            ...(mode === 'restored' ? { restoredHistory: true as const } : {}),
            ...(mode === 'pending shortcut'
              ? { localChoicePending: true as const }
              : {}),
          }}
          copyScope={copyScope}
        />
      </ConversationBubbleEntranceContext.Provider>,
    );
    const shell = screen.getByTestId('conversation-user-message');
    const body = within(shell).getByTestId('conversation-message-body');
    const isolated = mode !== 'without copy';
    let position = shell;
    if (isolated) {
      let parent = shell.parent;
      while (parent && typeof parent.type !== 'string') parent = parent.parent;
      if (!parent) throw new Error('Missing outgoing bubble wrapper');
      position = parent;
      const surfaceStyle = StyleSheet.flatten(shell.props.style);
      expect(surfaceStyle).not.toHaveProperty('alignSelf');
      expect(surfaceStyle).not.toHaveProperty('maxWidth');
      expect(surfaceStyle).not.toHaveProperty('transform');
    }
    expect(StyleSheet.flatten(position.props.style)).toMatchObject({
      alignSelf: 'flex-end',
      maxWidth: '85%',
    });
    expect(StyleSheet.flatten(shell.props.style)).toMatchObject({
      borderRadius: 18,
    });
    expect(StyleSheet.flatten(shell.props.style)).not.toHaveProperty('padding');
    expect(StyleSheet.flatten(body.props.style)).toMatchObject({ padding: 14 });
    expect(within(body).getByText(content)).toBeVisible();
    expect(shell.props.copyText).toBe(
      copyScope && mode !== 'pending shortcut' ? content : undefined,
    );
  },
);
