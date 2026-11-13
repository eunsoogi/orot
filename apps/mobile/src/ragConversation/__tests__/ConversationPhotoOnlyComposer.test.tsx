import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationComposer } from '../ConversationComposer';

test('photo-only send requires an explicitly ready OCR delivery path', async () => {
  const onSend = jest.fn();
  const base = {
    value: '',
    busy: false,
    onChangeText: jest.fn(),
    onSend,
    onCancel: jest.fn(),
  };
  const photo = {
    status: 'ready' as const,
    onSelect: jest.fn(),
    onRemove: jest.fn(),
  };
  const view = await render(<ConversationComposer {...base} photo={photo} />);
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(true);
  await view.rerender(
    <ConversationComposer
      {...base}
      photo={{ ...photo, deliveryReady: true, deliveryMode: 'ocr' }}
    />,
  );
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(
    false,
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(onSend).toHaveBeenCalledTimes(1);
  await view.rerender(
    <ConversationComposer
      {...base}
      photo={{
        ...photo,
        status: 'transferring',
        deliveryReady: true,
        deliveryMode: 'ocr',
      }}
    />,
  );
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(true);
});
