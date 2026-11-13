import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationPhotoConsent } from '../ConversationPhotoConsent';

test('explicitly confirms the selected provider and OCR-only transfer', async () => {
  const onApprove = jest.fn();
  const onCancel = jest.fn();
  await render(
    <ConversationPhotoConsent
      visible
      providerName="합성 제공자"
      modelId="합성 모델"
      recipient="선택한 계정"
      remoteProcessing
      onApprove={onApprove}
      onCancel={onCancel}
    />,
  );
  expect(
    screen.getByText('합성 제공자에서 사진의 글자를 처리해요.'),
  ).toBeTruthy();
  expect(
    screen.getByText('모델: 합성 모델\n처리 대상: 선택한 계정'),
  ).toBeTruthy();
  expect(
    screen.getByText(
      '추출한 글자가 선택한 서비스로 전송돼요. 사진 원본은 보내지 않아요.',
    ),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '동의하고 계속' }));
  expect(onApprove).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});

test('local processing is named accurately and dismissal denies approval', async () => {
  const onApprove = jest.fn();
  const onCancel = jest.fn();
  await render(
    <ConversationPhotoConsent
      visible
      providerName="기기 내 모델"
      modelId="기기 모델"
      recipient="이 기기"
      remoteProcessing={false}
      onApprove={onApprove}
      onCancel={onCancel}
    />,
  );
  expect(
    screen.getByText(
      '추출한 글자를 이 기기에서 처리해요. 사진 원본은 보내지 않아요.',
    ),
  ).toBeTruthy();
  await fireEvent(
    screen.getByTestId('conversation-photo-consent'),
    'requestClose',
  );
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onApprove).not.toHaveBeenCalled();
});
