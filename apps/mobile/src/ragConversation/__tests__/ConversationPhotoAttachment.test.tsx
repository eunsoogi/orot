import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ConversationPhotoAttachment } from '../ConversationPhotoAttachment';
import { ConversationComposer } from '../ConversationComposer';

test('photo selection and removal are explicit actions, independent of send', async () => {
  const onSelect = jest.fn();
  const onRemove = jest.fn();
  const view = await render(
    <ConversationPhotoAttachment
      status="empty"
      onSelect={onSelect}
      onRemove={onRemove}
    />,
  );
  expect(
    screen.getByRole('button', { name: '사진 첨부' }).props.onAction,
  ).toEqual(expect.any(Function));
  expect(screen.getByRole('button', { name: '사진 첨부' })).toHaveStyle({
    width: 44,
    height: 44,
    borderRadius: 0,
    overflow: 'visible',
  });
  await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
  expect(
    screen.getByRole('button', { name: '사진 첨부' }).props.accessibilityHint,
  ).toBe('한 번에 사진 한 장을 선택해요.');
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onRemove).not.toHaveBeenCalled();
  await view.rerender(
    <ConversationPhotoAttachment
      status="ready"
      previewData="data:image/jpeg;base64,c3ludGhldGlj"
      onSelect={onSelect}
      onRemove={onRemove}
    />,
  );
  expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '첨부 사진 제거' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test('preparation and errors are announced without triggering another selection', async () => {
  const onSelect = jest.fn();
  const view = await render(
    <ConversationPhotoAttachment
      status="preparing"
      onSelect={onSelect}
      onRemove={jest.fn()}
    />,
  );
  expect(screen.getByText('사진을 준비하고 있어요.')).toBeTruthy();
  expect(screen.getByRole('button', { name: '사진 첨부' })).toBeDisabled();
  await view.rerender(
    <ConversationPhotoAttachment
      status="error"
      onSelect={onSelect}
      onRemove={jest.fn()}
    />,
  );
  expect(
    screen.getByText('사진을 준비하지 못했어요. 다시 선택해 주세요.'),
  ).toBeTruthy();
  expect(onSelect).not.toHaveBeenCalled();
});

test('a selected photo remains removable when its preview is unavailable', async () => {
  const onRemove = jest.fn();
  await render(
    <ConversationPhotoAttachment
      status="ready"
      onSelect={jest.fn()}
      onRemove={onRemove}
    />,
  );
  expect(screen.queryByTestId('conversation-photo-preview')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '첨부 사진 제거' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
});

test('another active picker disables selection without disabling removal', async () => {
  const onRemove = jest.fn();
  await render(
    <ConversationPhotoAttachment
      status="ready"
      pickerDisabled
      onSelect={jest.fn()}
      onRemove={onRemove}
    />,
  );
  expect(screen.getByRole('button', { name: '사진 첨부' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: '첨부 사진 제거' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
});

test('the composer keeps a separate trailing action outside the photo and send controls', async () => {
  await render(
    <ConversationComposer
      value="합성 질문"
      busy={false}
      onChangeText={jest.fn()}
      onSend={jest.fn()}
      onCancel={jest.fn()}
      photo={{ status: 'empty', onSelect: jest.fn(), onRemove: jest.fn() }}
      trailingAction={<Text testID="synthetic-trailing-action">별도 동작</Text>}
    />,
  );
  expect(screen.getByTestId('synthetic-trailing-action')).toBeTruthy();
  expect(screen.getByRole('button', { name: '사진 첨부' })).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-send')).toBeTruthy();
});

test('explains when the selected photo has no recognized text', async () => {
  await render(
    <ConversationPhotoAttachment
      status="error"
      errorReason="empty"
      onSelect={jest.fn()}
      onRemove={jest.fn()}
    />,
  );
  expect(
    screen.getByText(
      '사진에서 글자를 찾지 못했어요. 글자가 잘 보이는 사진을 선택해 주세요.',
    ),
  ).toBeTruthy();
});

test('exposes retry when a retired photo could not be cleaned up', async () => {
  const retry = jest.fn();
  await render(
    <ConversationPhotoAttachment
      status="error"
      cleanupPending
      onRetryCleanup={retry}
      onSelect={jest.fn()}
      onRemove={jest.fn()}
    />,
  );
  await fireEvent.press(
    screen.getByRole('button', { name: '임시 사진 정리 다시 시도' }),
  );
  expect(retry).toHaveBeenCalledTimes(1);
});

test('composer cannot send a text-only request while its photo is being prepared', async () => {
  const onSend = jest.fn();
  const photo = {
    status: 'preparing' as const,
    onSelect: jest.fn(),
    onRemove: jest.fn(),
  };
  await render(
    <ConversationComposer
      value="합성 질문"
      busy={false}
      onChangeText={jest.fn()}
      onSend={onSend}
      onCancel={jest.fn()}
      photo={photo}
    />,
  );
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(true);
  expect(onSend).not.toHaveBeenCalled();
});

test('a photo being handed to a request cannot be sent or replaced again', async () => {
  await render(
    <ConversationComposer
      value="합성 질문"
      busy={false}
      onChangeText={jest.fn()}
      onSend={jest.fn()}
      onCancel={jest.fn()}
      photo={{
        status: 'transferring',
        hasPhoto: true,
        onSelect: jest.fn(),
        onRemove: jest.fn(),
      }}
    />,
  );
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(true);
  expect(screen.getByRole('button', { name: '사진 첨부' })).toBeDisabled();
  expect(
    screen.getByText('사진을 안전하게 전송할 준비를 하고 있어요.'),
  ).toBeTruthy();
});

test('a selected photo cannot be silently omitted when attachment delivery is unavailable', async () => {
  const base = {
    value: '합성 질문',
    busy: false,
    onChangeText: jest.fn(),
    onSend: jest.fn(),
    onCancel: jest.fn(),
  };
  const photo = {
    status: 'ready' as const,
    previewData: 'data:image/jpeg;base64,c3ludGhldGlj',
    onSelect: jest.fn(),
    onRemove: jest.fn(),
  };
  const view = await render(<ConversationComposer {...base} photo={photo} />);
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(true);
  expect(
    screen.getByText(
      '사진을 보낼 준비가 되지 않았어요. 다시 시도하거나 사진을 제거해 주세요.',
    ),
  ).toBeTruthy();
  await view.rerender(
    <ConversationComposer
      {...base}
      photo={{ ...photo, deliveryReady: true }}
    />,
  );
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
  expect(
    screen.getByText(
      '사진에서 추출한 글자를 보내요. 사진 자체는 보내지 않아요.',
    ),
  ).toBeTruthy();
});
