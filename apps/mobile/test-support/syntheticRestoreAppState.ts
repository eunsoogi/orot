import type { ConversationHistoryPage } from '../src/ragConversation/conversationHistoryPage';
import { act } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

/** Feed the existing app observers without letting background act as root-tab intent. */
export function mountSyntheticRestoreAppState(observePhase: boolean) {
  const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const mockSubscribe = jest.mocked(AppState.addEventListener);
  const originalSubscribe = mockSubscribe.getMockImplementation()!;
  const observers = new Set<(state: AppStateStatus) => void>();
  if (observePhase)
    mockSubscribe.mockImplementation((event, listener) => {
      const subscription = originalSubscribe(event, listener);
      if (event === 'change') observers.add(listener);
      return {
        remove: () => {
          observers.delete(listener);
          subscription.remove();
        },
      };
    });
  const phase = async (state: AppStateStatus) => {
    await act(async () => {
      Object.defineProperty(AppState, 'currentState', {
        configurable: true,
        value: state,
      });
      for (const observer of [...observers]) observer(state);
    });
  };
  return {
    phase,
    reset() {
      mockSubscribe.mockImplementation(originalSubscribe);
      if (original) Object.defineProperty(AppState, 'currentState', original);
    },
  };
}

export function deferredPage() {
  let settle!: (page: ConversationHistoryPage) => void;
  const promise = new Promise<ConversationHistoryPage>(resolve => {
    settle = resolve;
  });
  return {
    promise,
    settle: (answer: string) =>
      settle({
        turns: [{ question: '합성 질문', answer, citations: [] }],
        taskCards: [],
        nextCursor: null,
      }),
  };
}
