import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { ConversationInterruptionRecovery } from '../ConversationInterruptionRecovery';
import type { ConversationSession } from '../conversationSessionTypes';

function fixture() {
  let session: ConversationSession = {
    id: 1,
    title: '합성',
    createdAt: '',
    draft: '',
    busy: false,
    error: '',
    pendingMessage: null,
    messages: [
      { id: 1, role: 'user', content: '합성 질문' },
      {
        id: 2,
        role: 'assistant',
        content: '미완료',
        incomplete: true,
        interruptionReason: 'expired',
      },
    ],
  };
  const setDraft = jest.fn();
  return {
    get: () => session,
    replace: (value: ConversationSession) => {
      session = value;
    },
    store: {
      setDraft,
      getSnapshot: () => ({ activeId: 1, deleted: null, sessions: [session] }),
    },
  };
}

test('review only restores the draft and never performs a send', async () => {
  const f = fixture();
  await render(
    <ConversationInterruptionRecovery store={f.store} session={f.get()} />,
  );
  await fireEvent.press(screen.getByText('질문 검토 후 이어하기'));
  expect(f.store.setDraft).toHaveBeenCalledWith(1, '합성 질문');
  expect(screen.getByText(/자동으로 실행하지 않아요/)).toBeTruthy();
});

test('a new draft or active request arriving before the tap is preserved', async () => {
  const f = fixture();
  await render(
    <ConversationInterruptionRecovery store={f.store} session={f.get()} />,
  );
  f.replace({ ...f.get(), draft: '다른 작성 내용' });
  await fireEvent.press(screen.getByText('질문 검토 후 이어하기'));
  expect(f.store.setDraft).not.toHaveBeenCalled();
  f.replace({ ...f.get(), draft: '', busy: true });
  await fireEvent.press(screen.getByText('질문 검토 후 이어하기'));
  expect(f.store.setDraft).not.toHaveBeenCalled();
});

test('intentional Stop does not produce a system-interruption recovery action', async () => {
  const f = fixture();
  f.replace({
    ...f.get(),
    messages: [
      f.get().messages[0]!,
      { ...f.get().messages[1]!, interruptionReason: 'user-stopped' },
    ],
  });
  await render(
    <ConversationInterruptionRecovery store={f.store} session={f.get()} />,
  );
  expect(screen.queryByText('질문 검토 후 이어하기')).toBeNull();
});

test('photo recovery is explained rather than silently sending a text-only substitute', async () => {
  const f = fixture();
  f.replace({
    ...f.get(),
    messages: [
      { ...f.get().messages[0]!, photoAttached: true },
      f.get().messages[1]!,
    ],
  });
  await render(
    <ConversationInterruptionRecovery store={f.store} session={f.get()} />,
  );
  await fireEvent.press(screen.getByText('질문 검토 후 이어하기'));
  expect(f.store.setDraft).not.toHaveBeenCalled();
  expect(screen.getByText(/사진이 포함된 질문/)).toBeTruthy();
});
