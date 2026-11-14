import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationHeaderTitle } from '../ConversationHeaderTitle';
import { VoiceConversationControl } from '../../voiceConversation/VoiceConversationControl';

/** Compositing contract: disabled foreground may change, but the native effect's ancestors stay opaque. */
function expectOpaqueAncestors(testID: string) {
  let node = screen.getByTestId(testID);
  while (node) {
    const opacity = StyleSheet.flatten(node.props.style)?.opacity;
    expect(opacity === undefined || opacity === 1).toBe(true);
    node = node.parent!;
  }
}

test('disabled voice keeps its Glass surface opaque and never starts audio', async () => {
  const onStart = jest.fn();
  await render(
    <VoiceConversationControl
      phase="idle"
      disabled
      startLabel="시작"
      stopLabel="중지"
      finishLabel="완료"
      recoverLabel="재시도"
      status=""
      onStart={onStart}
      onStop={jest.fn()}
      onFinish={jest.fn()}
      onRecover={jest.fn()}
    />,
  );
  expectOpaqueAncestors('voice-control-glass');
  const action = screen.getByRole('button', { name: '시작' });
  expect(action).toBeDisabled();
  await fireEvent.press(action);
  expect(onStart).not.toHaveBeenCalled();
});

test('unavailable history keeps Glass opaque while new conversation remains usable', async () => {
  const onNew = jest.fn();
  await render(
    <ConversationHeaderTitle
      title="대화"
      historyLabel="기록"
      newLabel="새 대화"
      showActions
      onNew={onNew}
    />,
  );
  expectOpaqueAncestors('rag-conversation-history-glass');
  expect(screen.getByRole('button', { name: '기록' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: '새 대화' }));
  expect(onNew).toHaveBeenCalledTimes(1);
});
