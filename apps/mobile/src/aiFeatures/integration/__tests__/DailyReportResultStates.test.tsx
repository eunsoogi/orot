import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { t } from '../../../i18n';
import { DailyReportRoute } from '../DailyReportRoute';
import type { createDailyReportFeature } from '../dailyReportFeature';

type Feature = ReturnType<typeof createDailyReportFeature>;
type Identity = ReturnType<typeof createDailyReportIdentity>;

function fixture(lookup: (identity: Identity) => unknown) {
  return {
    lookup: jest.fn(async (identity: Identity) => lookup(identity)),
    preview: jest.fn<
      ReturnType<Feature['preview']>,
      Parameters<Feature['preview']>
    >(async () => ({ status: 'not_today' })),
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

test('a source revision change after regeneration hides the prior saved report', async () => {
  let lookups = 0;
  const feature = fixture(identity => {
    lookups += 1;
    return lookups === 1
      ? {
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
        }
      : {
          status: 'stale',
          runId: 'previous',
          revision: 3,
          sourceStatus: 'stale',
        };
  });
  feature.start = jest.fn(() => ({
    status: 'started' as const,
    cancel: jest.fn(),
    result: Promise.resolve({
      status: 'failed' as const,
      code: 'source_revision_changed',
    }),
  }));
  await render(
    <DailyReportRoute
      feature={feature as unknown as Feature}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );
  await screen.findByText('이전에 저장된 합성 기록');
  await fireEvent.press(screen.getByText('다시 요약하기'));
  expect(
    await screen.findByText(
      '기록이 바뀌어 저장된 보고서를 표시할 수 없어요. 오늘을 선택해 다시 요약할 수 있어요.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText('이전에 저장된 합성 기록')).toBeNull();
  expect(feature.start).toHaveBeenCalledWith(expect.anything(), {
    kind: 'revise',
    expectedRunId: 'previous',
  });
});

test('saved content appears during preview loading and survives retrying a failed preview', async () => {
  const feature = fixture(identity => ({
    status: 'saved',
    runId: 'previous',
    revision: 3,
    context: { identity, generationCutoff: '2026-11-09T03:00:00Z' },
    report: {
      generatedAt: '2026-11-09T03:01:00Z',
      observations: [{ text: '저장된 합성 기록' }],
      supportedContext: [],
      followUpQuestions: [],
      coverage: [],
    },
  }));
  let rejectPreview!: (error: Error) => void;
  feature.preview.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectPreview = reject;
      }),
  );
  await render(
    <DailyReportRoute
      feature={feature as unknown as Feature}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );
  expect(screen.getByText('저장된 합성 기록')).toBeTruthy();
  await act(async () => rejectPreview(new Error('Synthetic preview failure')));
  await screen.findByRole('alert');
  await fireEvent.press(screen.getByRole('button', { name: '다시 확인' }));
  expect(screen.getByText('저장된 합성 기록')).toBeTruthy();
  expect(feature.lookup).toHaveBeenCalledTimes(1);
  expect(feature.preview).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('the current preview appears while the saved lookup is pending', async () => {
  let finishLookup!: (value: { status: 'missing' }) => void;
  const feature = fixture(
    () =>
      new Promise(resolve => {
        finishLookup = resolve;
      }),
  );
  feature.preview.mockResolvedValueOnce({
    status: 'ready',
    cutoff: '2026-11-09T03:00:00Z',
    count: 0,
    partial: false,
    coverage: [],
    latestSourceTime: null,
  });
  await render(
    <DailyReportRoute
      feature={feature as unknown as Feature}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );
  expect(screen.getByText(t('dailyReport.empty'))).toBeTruthy();
  expect(screen.getByText(t('dailyReport.preparing'))).toBeTruthy();
  await act(async () => finishLookup({ status: 'missing' }));
  expect(screen.queryByText(t('dailyReport.preparing'))).toBeNull();
});
