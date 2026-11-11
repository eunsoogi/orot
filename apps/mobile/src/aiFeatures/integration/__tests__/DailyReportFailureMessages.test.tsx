import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { DailyReportRoute } from '../DailyReportRoute';
import type { createDailyReportFeature } from '../dailyReportFeature';

type Feature = ReturnType<typeof createDailyReportFeature>;

function featureFor(code: string) {
  return {
    lookup: jest.fn(async () => ({ status: 'missing' as const })),
    preview: jest.fn(async () => ({
      status: 'ready' as const,
      cutoff: '2035-01-01T12:00:00Z',
      count: 1,
      partial: false,
      coverage: [],
      latestSourceTime: null,
    })),
    start: jest.fn(() => ({
      status: 'started' as const,
      cancel: jest.fn(),
      result: Promise.resolve({ status: 'failed' as const, code }),
    })),
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  };
}

test.each([
  [
    'source_read_failed',
    '이 날짜의 기록을 읽지 못했어요. 기록을 확인한 뒤 다시 요약해 주세요.',
  ],
  [
    'source_unavailable',
    '이 날짜에서 보고서에 사용할 기록을 찾지 못했어요. 기록 상태를 확인한 뒤 다시 요약해 주세요.',
  ],
  [
    'day_changed',
    '오늘 날짜가 바뀌어 보고서를 시작하지 못했어요. 오늘을 선택하고 다시 요약해 주세요.',
  ],
  [
    'not_today',
    '오늘 날짜가 바뀌어 보고서를 시작하지 못했어요. 오늘을 선택하고 다시 요약해 주세요.',
  ],
  [
    'provider_unavailable',
    '선택한 AI 요청을 완료하지 못했어요. 제공자와 모델을 확인한 뒤 다시 요약해 주세요.',
  ],
  [
    'consent_required',
    '선택한 외부 AI 요청이 승인되지 않았어요. 요청을 확인하고 동의한 뒤 다시 요약해 주세요.',
  ],
  [
    'malformed_output',
    'AI 응답을 확인할 수 없어 저장하지 않았어요. 선택한 모델을 확인한 뒤 다시 요약해 주세요.',
  ],
  [
    'persistence_failed',
    '이번 보고서를 저장하지 못했어요. 다시 요약하면 새로 만들어 저장해요.',
  ],
  ['error', '요청을 완료하지 못했어요. 잠시 후 다시 요약해 주세요.'],
])(
  'explains a %s failure and leaves the explicit retry action available',
  async (code, message) => {
    const feature = featureFor(code);
    await render(
      <DailyReportRoute
        feature={feature as unknown as Feature}
        providerSelection={null}
        onBack={jest.fn()}
        onChat={jest.fn()}
      />,
    );

    await fireEvent.press(await screen.findByText('오늘 요약하기'));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText('오늘 요약하기')).toBeTruthy();
  },
);

test('a saved-report read failure offers a lookup retry instead of rerunning generation', async () => {
  const feature = featureFor('report_read_failed');
  await render(
    <DailyReportRoute
      feature={feature as unknown as Feature}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );

  await fireEvent.press(await screen.findByText('오늘 요약하기'));
  expect(
    await screen.findByText(
      '저장된 보고서를 확인하지 못했어요. 다시 시도해 주세요.',
    ),
  ).toBeTruthy();
  expect(screen.getByText('다시 확인')).toBeTruthy();
  expect(screen.queryByText('오늘 요약하기')).toBeNull();

  await fireEvent.press(screen.getByText('다시 확인'));
  await waitFor(() => expect(feature.lookup).toHaveBeenCalledTimes(2));
  expect(
    screen.queryByText(
      '저장된 보고서를 확인하지 못했어요. 다시 시도해 주세요.',
    ),
  ).toBeNull();
});
