import { renderHook } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import type { DisplayMessage } from '../conversationDisplayMessage';
import { useConversationFinalCommitDiagnostic } from '../conversationFinalCommitDiagnostic';

test('marks a live answer commit, not pending, restored, hidden, or repaint output', async () => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  const answer: DisplayMessage = {
    id: 1,
    role: 'assistant',
    content: 'Synthetic answer',
    citations: [],
  };
  const { rerender } = await renderHook<
    void,
    { message: DisplayMessage; showBody: boolean }
  >(
    ({ message, showBody }) =>
      useConversationFinalCommitDiagnostic(message, showBody),
    {
      initialProps: {
        message: { ...answer, streaming: true } as DisplayMessage,
        showBody: true,
      },
    },
  );
  try {
    await rerender({
      message: { ...answer, restoredHistory: true },
      showBody: true,
    });
    await rerender({ message: answer, showBody: false });
    expect(report).not.toHaveBeenCalled();
    await rerender({ message: answer, showBody: true });
    await rerender({
      message: { ...answer, content: 'Another synthetic string' },
      showBody: true,
    });
    expect(report.mock.calls).toEqual([
      ['rag', 'conversation_final_react_commit', 'completed'],
    ]);
  } finally {
    delete NativeModules.OrotProviderDiagnostics;
  }
});
