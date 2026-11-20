import {
  fireEvent,
  screen,
  type RenderResult,
} from '@testing-library/react-native';

/** Drive the real reused consent sheet, not a parallel voice-specific alert. */
export async function tapVoiceSettingsAlertButton(label: '동의' | '취소') {
  const action = label === '동의' ? 'allow' : 'cancel';
  await fireEvent.press(
    await screen.findByTestId(`inference-disclosure-${action}`),
  );
}

export function expectNoInlineVoiceConsent(view: RenderResult) {
  for (const text of [
    /별도로 동의해야 합니다/,
    /API 사용 요금/,
    /이 API 계정의 모델 목록을 새로고침/,
    /기기 내 처리:/,
  ])
    expect(view.queryByText(text)).toBeNull();
  expect(
    view.queryByTestId('model-settings-transmission-disclosure'),
  ).toBeNull();
}

export async function expectLiveSettingsDisclosure(view: RenderResult) {
  expect(
    await view.findByTestId('inference-disclosure-recipient'),
  ).toHaveTextContent('OpenAI Live API');
  expect(view.queryByTestId('inference-disclosure-expand')).toBeNull();
}
