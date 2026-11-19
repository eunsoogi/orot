import { StrictMode } from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationRestartAction } from '../ConversationRestartAction';
import { createEmptyConversation } from '../conversationEmptySession';

function interrupted(id: number) {
  return {
    ...createEmptyConversation(id),
    messages: [
      { id: 1, role: 'user' as const, content: '합성 질문' },
      {
        id: 2,
        role: 'assistant' as const,
        content: '합성 중단',
        incomplete: true,
        interruptionReason: 'expired' as const,
      },
    ],
  };
}

// A native Alert can outlive its React owner. Returning to the same object must
// not resurrect an older confirmation; a newly displayed Alert may still work.
test.each(['unmount', 'session-aba', 'response-aba'] as const)(
  'old confirmation is terminal across %s, including StrictMode remount',
  async boundary => {
    const a = interrupted(1);
    const b = boundary === 'session-aba' ? interrupted(2) : interrupted(1);
    let current = a;
    const store = {
      getSnapshot: () => ({
        activeId: current.id,
        sessions: [current],
        deleted: null,
      }),
    };
    const restart = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const component = () => (
      <StrictMode>
        <ConversationRestartAction
          store={store}
          session={current}
          onRestart={restart}
        />
      </StrictMode>
    );
    let view = await render(component());
    try {
      await fireEvent.press(screen.getByText('다시 요청'));
      const old = alert.mock.calls.at(-1)?.[2]?.[1]?.onPress;
      if (boundary === 'unmount') {
        await view.unmount();
        await act(async () => {
          old?.();
        });
        expect(restart).not.toHaveBeenCalled();
        view = await render(component());
      } else {
        current = b;
        await view.rerender(component());
        current = a;
        await view.rerender(component());
      }
      await act(async () => {
        old?.();
      });
      expect(restart).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByText('다시 요청'));
      await act(async () => {
        const confirm = alert.mock.calls.at(-1)?.[2]?.[1]?.onPress;
        confirm?.();
        confirm?.();
      });
      expect(restart).toHaveBeenCalledTimes(1);
      expect(restart).toHaveBeenCalledWith('합성 질문');
    } finally {
      await view.unmount();
      alert.mockRestore();
    }
  },
);

test('Cancel consumes its own confirmation even when an old native callback arrives', async () => {
  const session = interrupted(1);
  const store = {
    getSnapshot: () => ({ activeId: 1, sessions: [session], deleted: null }),
  };
  const restart = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = await render(
    <ConversationRestartAction
      store={store}
      session={session}
      onRestart={restart}
    />,
  );
  try {
    await fireEvent.press(screen.getByText('다시 요청'));
    const buttons = alert.mock.calls.at(-1)?.[2];
    await act(async () => {
      buttons?.[0]?.onPress?.();
      buttons?.[1]?.onPress?.();
    });
    expect(restart).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    alert.mockRestore();
  }
});
