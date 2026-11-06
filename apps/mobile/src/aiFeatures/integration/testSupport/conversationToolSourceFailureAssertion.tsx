import { createElement } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { ConversationMessage } from '../../../ragConversation/ConversationMessage';
import type { ResolveConversationToolSource } from '../../../ragConversation/ConversationToolEventSources';

/** Keep a restored tool source closed when the real resolver rejects its persisted reference. */
export async function expectUnavailableConversationToolSource({
  toolMessageId,
  toolEvents,
  resolveToolSource,
}: {
  readonly toolMessageId: string;
  readonly toolEvents: readonly ConversationToolEvent[];
  readonly resolveToolSource: ResolveConversationToolSource;
}) {
  const event = toolEvents[0];
  if (!event) throw new Error('Expected a persisted tool event.');
  const onOpenSource = jest.fn();
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

  await render(
    createElement(ConversationMessage, {
      message: {
        id: 1,
        role: 'assistant',
        content: '',
        toolMessageId,
        toolEvents,
      },
      onLinkError: jest.fn(),
      onOpenSource,
      resolveToolSource,
      toolSourceSessionId: 'session',
    }),
  );
  await fireEvent.press(
    screen.getByTestId(
      `rag-tool-event-${event.operationRunId}-${event.callId}-toggle`,
    ),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: /원문 출처 확인/u }),
  );
  await waitFor(() =>
    expect(
      screen.getByText('저장된 출처를 다시 확인할 수 없어 열지 않았어요.'),
    ).toBeTruthy(),
  );

  expect(onOpenSource).not.toHaveBeenCalled();
  expect(openURL).not.toHaveBeenCalled();
}
