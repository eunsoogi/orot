import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { ConversationRetainedToolSources } from '../ConversationRetainedToolSources';
import { conversationToolEventFixtures } from '../testSupport/conversationToolEventFixtures';

const event = conversationToolEventFixtures[0]!;
const reference: EvidenceReference = {
  ...event.sources[0]!,
  reviewState: 'unknown',
  effectiveTime: '2026-01-01',
  locator: { title: 'Synthetic retained record' },
};

// Removing progress UI must not bypass source ownership or silently remove evidence access.
test.each([true, false])(
  'retained evidence opening respects validation: %s',
  async allowed => {
    const resolve = jest.fn(async () => (allowed ? reference : undefined));
    const open = jest.fn();
    const error = jest.fn();
    await render(
      <ConversationRetainedToolSources
        events={conversationToolEventFixtures}
        sessionId="synthetic-session"
        durableMessageId="synthetic-turn"
        resolveToolSource={resolve}
        onOpenSource={open}
        onLinkError={error}
      />,
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.queryByTestId('rag-conversation-tool-events')).toBeNull();
    await fireEvent.press(screen.getByRole('button'));
    expect(resolve).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByRole('button', { name: /원문 출처 확인/u }),
    );
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(resolve).toHaveBeenCalledWith(
      event.sources[0],
      expect.any(AbortSignal),
      {
        sessionId: 'synthetic-session',
        operationRunId: event.operationRunId,
        callId: event.callId,
      },
    );
    if (allowed)
      await waitFor(() => expect(open).toHaveBeenCalledWith(reference));
    else {
      await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
      expect(open).not.toHaveBeenCalled();
    }
  },
);
