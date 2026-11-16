import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ConversationRestartAction } from '../ConversationRestartAction';
import type { ConversationSession } from '../conversationSessionTypes';
function fixture() {
  let session: ConversationSession = {
    id: 1,
    title: 'Synthetic',
    createdAt: '',
    error: '',
    pendingMessage: null,
    busy: false,
    draft: '',
    messages: [
      { id: 1, role: 'user', content: '합성 질문' },
      {
        id: 2,
        role: 'assistant',
        content: '',
        incomplete: true,
        interruptionReason: 'expired',
      },
    ],
  };
  return {
    get: () => session,
    set: (value: ConversationSession) => {
      session = value;
    },
    store: {
      getSnapshot: () => ({ activeId: 1, deleted: null, sessions: [session] }),
    },
  };
}
afterEach(() => jest.restoreAllMocks());
test('only a separate confirmation starts a new request and discloses cost and duplicate effects', async () => {
  const f = fixture();
  const restart = jest.fn();
  const alert = jest.spyOn(Alert, 'alert');
  await render(
    <ConversationRestartAction
      store={f.store}
      session={f.get()}
      onRestart={restart}
    />,
  );
  await fireEvent.press(screen.getByText('새 요청으로 다시 시작'));
  expect(restart).not.toHaveBeenCalled();
  expect(alert.mock.calls[0]?.[1]).toMatch(/추가 API 비용/);
  expect(alert.mock.calls[0]?.[1]).toMatch(/중복/);
  alert.mock.calls[0]?.[2]?.[1]?.onPress?.();
  expect(restart).toHaveBeenCalledWith('합성 질문');
});
test('a stale confirmation cannot start work after a newer request', async () => {
  const f = fixture();
  const restart = jest.fn();
  const alert = jest.spyOn(Alert, 'alert');
  await render(
    <ConversationRestartAction
      store={f.store}
      session={f.get()}
      onRestart={restart}
    />,
  );
  await fireEvent.press(screen.getByText('새 요청으로 다시 시작'));
  f.set({ ...f.get(), busy: true });
  alert.mock.calls[0]?.[2]?.[1]?.onPress?.();
  expect(restart).not.toHaveBeenCalled();
});
test('photo consent is not reused by the restart button', async () => {
  const f = fixture();
  const restart = jest.fn();
  f.set({
    ...f.get(),
    messages: [
      { ...f.get().messages[0]!, photoAttached: true },
      f.get().messages[1]!,
    ],
  });
  await render(
    <ConversationRestartAction
      store={f.store}
      session={f.get()}
      onRestart={restart}
    />,
  );
  expect(screen.queryByText('새 요청으로 다시 시작')).toBeNull();
  expect(screen.getByText(/사진을 다시 첨부/)).toBeTruthy();
});
