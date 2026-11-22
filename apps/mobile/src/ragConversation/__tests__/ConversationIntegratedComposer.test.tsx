import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { VoiceConversationControl } from '../../voiceConversation/VoiceConversationControl';
import { ConversationComposer } from '../ConversationComposer';

test.each([false, true])(
  'one growing surface contains actions and the removable photo (compact %s)',
  async compact => {
    const select = jest.fn();
    const remove = jest.fn();
    const start = jest.fn();
    const send = jest.fn();
    const cancel = jest.fn();
    const base = {
      value: '합성 질문',
      onChangeText: jest.fn(),
      onSend: send,
      onCancel: cancel,
      compact,
    };
    const input = (attached: boolean, busy = false) => (
      <ConversationComposer
        {...base}
        value={busy ? '' : base.value}
        busy={busy}
        photo={{
          status: attached ? 'ready' : 'empty',
          previewData: attached
            ? 'data:image/jpeg;base64,c3ludGhldGlj'
            : undefined,
          onSelect: select,
          onRemove: remove,
        }}
        trailingAction={
          <VoiceConversationControl
            phase="idle"
            disabled={attached || busy}
            startLabel="음성 시작"
            stopLabel="음성 중지"
            finishLabel="음성 완료"
            recoverLabel="음성 재시도"
            status=""
            onStart={start}
            onStop={jest.fn()}
            onFinish={jest.fn()}
            onRecover={jest.fn()}
          />
        }
      />
    );
    const view = await render(input(false));
    const field = () =>
      within(screen.getByTestId('rag-conversation-composer-field'));
    expect(
      field().getAllByTestId('rag-conversation-composer-glass'),
    ).toHaveLength(1);
    expect(field().queryByTestId('conversation-photo-tray')).toBeNull();
    await fireEvent.press(field().getByRole('button', { name: '사진 첨부' }));
    await fireEvent.press(field().getByRole('button', { name: '음성 시작' }));
    expect(select).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);

    await view.rerender(input(true));
    const tray = within(field().getByTestId('conversation-photo-tray'));
    expect(tray.getByTestId('conversation-photo-preview')).toBeTruthy();
    expect(field().getByTestId('rag-conversation-input').props.editable).toBe(
      true,
    );
    expect(field().getByRole('button', { name: '음성 시작' })).toBeDisabled();
    expect(field().getByTestId('rag-conversation-send').props.disabled).toBe(
      true,
    );
    await fireEvent.press(tray.getByRole('button', { name: '첨부 사진 제거' }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();

    await view.rerender(input(false, true));
    expect(field().queryByTestId('conversation-photo-tray')).toBeNull();
    await fireEvent(
      field().getByTestId('rag-conversation-cancel'),
      'composerPress',
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(
      field().getAllByTestId('rag-conversation-composer-glass'),
    ).toHaveLength(1);
  },
);
