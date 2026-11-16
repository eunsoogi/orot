import React from 'react';
import { conversationInterruptionKo } from '../../i18n/conversationInterruptionKo';
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

test('an uncertain interrupted request has no resend disguised as continuation', async () => {
  const f = fixture();
  await render(
    <ConversationInterruptionRecovery store={f.store} session={f.get()} />,
  );
  expect(screen.queryByText(/저장된 진행 상황을 확인/)).toBeNull();
  expect(screen.queryByText('질문 검토 후 이어하기')).toBeNull();
  expect(screen.queryByText('작업 이어하기')).toBeNull();
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

test('a safe graph continuation invokes its live owner without changing the question', async () => {
  const f = fixture();
  const continueWorkflow = jest.fn();
  f.replace({ ...f.get(), busy: true, continueWorkflow });
  await render(
    <ConversationInterruptionRecovery store={f.store} session={f.get()} />,
  );
  await fireEvent.press(screen.getByText('작업 이어하기'));
  expect(continueWorkflow).toHaveBeenCalledTimes(1);
  expect(f.store.setDraft).not.toHaveBeenCalled();
  f.replace({ ...f.get(), continueWorkflow: undefined });
  await fireEvent.press(screen.getByText('작업 이어하기'));
  expect(continueWorkflow).toHaveBeenCalledTimes(1);
});

test('interruption guidance never presents resending as workflow continuation', () => {
  expect(Object.values(conversationInterruptionKo).join(' ')).not.toMatch(
    /다시 보내|질문 검토 후/,
  );
  expect(
    conversationInterruptionKo['conversationInterruption.process-interrupted'],
  ).toContain('자동으로 다시 실행하지 않아요');
});

test('recovery keeps horizontal space and inspects only after an explicit tap', async () => {
  const f = fixture();
  const refreshRecovery = jest.fn(async () => false);
  await render(
    <ConversationInterruptionRecovery
      store={{ ...f.store, refreshRecovery }}
      session={f.get()}
    />,
  );
  expect(screen.getByTestId('conversation-interruption-recovery')).toHaveStyle({
    marginHorizontal: 24,
    marginBottom: 8,
  });
  expect(refreshRecovery).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('이어갈 수 있는지 확인'));
  expect(refreshRecovery).toHaveBeenCalledWith(1, expect.any(AbortSignal));
  expect(screen.getByText(/이어갈 저장 지점이 없어요/)).toBeTruthy();
  expect(f.store.setDraft).not.toHaveBeenCalled();
});

test('a stalled checkpoint inspection times out and allows another explicit attempt', async () => {
  jest.useFakeTimers();
  const f = fixture();
  let signal: AbortSignal | undefined;
  const refreshRecovery = jest.fn((_id: number, value: AbortSignal) => {
    signal = value;
    return new Promise<boolean>(() => {});
  });
  const view = await render(
    <ConversationInterruptionRecovery
      store={{ ...f.store, refreshRecovery }}
      session={f.get()}
    />,
  );
  const press = fireEvent.press(screen.getByText('이어갈 수 있는지 확인'));
  await jest.advanceTimersByTimeAsync(5000);
  await press;
  expect(signal?.aborted).toBe(true);
  expect(screen.getByText('이어갈 수 있는지 확인')).toBeTruthy();
  expect(screen.queryByText('확인 중…')).toBeNull();
  expect(screen.getByText(/진행 상황을 확인하지 못했어요/)).toBeTruthy();
  expect(f.store.setDraft).not.toHaveBeenCalled();
  refreshRecovery.mockResolvedValueOnce(false);
  await fireEvent.press(screen.getByText('이어갈 수 있는지 확인'));
  expect(refreshRecovery).toHaveBeenCalledTimes(2);
  await view.unmount();
  jest.useRealTimers();
});

test('an inspection error does not claim that a checkpoint is absent', async () => {
  const f = fixture();
  await render(
    <ConversationInterruptionRecovery
      store={{
        ...f.store,
        refreshRecovery: jest.fn(async () => {
          throw new Error('synthetic locked read');
        }),
      }}
      session={f.get()}
    />,
  );
  await fireEvent.press(screen.getByText('이어갈 수 있는지 확인'));
  expect(screen.getByText(/진행 상황을 확인하지 못했어요/)).toBeTruthy();
  expect(screen.queryByText(/이어갈 저장 지점이 없어요/)).toBeNull();
});
