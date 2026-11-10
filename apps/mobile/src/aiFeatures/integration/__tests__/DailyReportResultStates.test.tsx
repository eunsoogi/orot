import { fireEvent, render, screen } from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { DailyReportRoute } from '../DailyReportRoute';
import type { createDailyReportFeature } from '../dailyReportFeature';

type Feature = ReturnType<typeof createDailyReportFeature>;
type Identity = ReturnType<typeof createDailyReportIdentity>;

function fixture(lookup: (identity: Identity) => unknown) {
  return {
    lookup: jest.fn(async (identity: Identity) => lookup(identity)),
    preview: jest.fn(async () => ({ status: 'not_today' })),
    start: jest.fn(() => ({
      status: 'started',
      cancel: jest.fn(),
      result: Promise.resolve({
        status: 'failed',
        code: 'provider_unavailable',
      }),
    })),
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  };
}

test.each([
  [
    { status: 'deleted' },
    '저장된 보고서를 찾을 수 없어요. 보고서나 출처 기록이 삭제되었을 수 있어요.',
  ],
  [
    { status: 'stale', runId: 'saved', revision: 2, sourceStatus: 'deleted' },
    '보고서의 출처 기록이 삭제되어 저장된 내용을 표시할 수 없어요.',
  ],
  [
    { status: 'error' },
    '저장된 보고서를 확인하지 못했어요. 다시 시도해 주세요.',
  ],
])(
  'distinguishes unavailable saved results from a missing report',
  async (result, message) => {
    const feature = fixture(() => result);
    await render(
      <DailyReportRoute
        feature={feature as unknown as Feature}
        initialIdentity={createDailyReportIdentity('2023-11-15', 'Asia/Seoul')}
        providerSelection={null}
        onBack={jest.fn()}
        onChat={jest.fn()}
      />,
    );
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(/이 날짜에 저장된 보고서가 없어요/u)).toBeNull();
    expect(feature.start).not.toHaveBeenCalled();
  },
);

test('a failed explicit regeneration keeps the existing saved revision available', async () => {
  const feature = fixture(identity => ({
    status: 'saved',
    runId: 'previous',
    revision: 3,
    context: { identity, generationCutoff: '2026-11-09T03:00:00Z' },
    report: {
      generatedAt: '2026-11-09T03:01:00Z',
      observations: [{ text: '이전에 저장된 합성 기록' }],
      supportedContext: [],
      followUpQuestions: [],
      coverage: [],
    },
  }));
  await render(
    <DailyReportRoute
      feature={feature as unknown as Feature}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );
  await screen.findByText('저장된 버전 3');
  expect(feature.start).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('다시 요약하기'));
  expect(feature.start).toHaveBeenCalledWith(expect.anything(), {
    kind: 'revise',
    expectedRunId: 'previous',
  });
  await screen.findByRole('alert');
  expect(screen.getByText('저장된 버전 3')).toBeTruthy();
  expect(screen.getByText('이전에 저장된 합성 기록')).toBeTruthy();
  expect(screen.getByText('다시 요약하기')).toBeTruthy();
});
