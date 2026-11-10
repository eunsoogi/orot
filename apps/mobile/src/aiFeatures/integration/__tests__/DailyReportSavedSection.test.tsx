import { fireEvent, render, screen } from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { DailyReportSavedSection } from '../DailyReportSavedSection';
import type { createDailyReportFeature } from '../dailyReportFeature';

test('a delayed lookup for an old revision cannot open follow-up after the revision changes', async () => {
  const identity = createDailyReportIdentity('2026-11-09', 'Asia/Seoul');
  const saved = {
    status: 'saved',
    runId: 'one',
    revision: 1,
    context: { identity, generationCutoff: '2026-11-09T03:00:00Z' },
    report: {
      generatedAt: '2026-11-09T03:01:00Z',
      observations: [],
      coverage: [],
    },
  } as unknown as Extract<
    Awaited<ReturnType<ReturnType<typeof createDailyReportFeature>['lookup']>>,
    { status: 'saved' }
  >;
  let resolve!: (value: typeof saved) => void;
  const feature = {
    lookup: jest.fn(
      () =>
        new Promise<typeof saved>(done => {
          resolve = done;
        }),
    ),
  } as unknown as ReturnType<typeof createDailyReportFeature>;
  const onChat = jest.fn();
  const view = await render(
    <DailyReportSavedSection
      saved={saved}
      feature={feature}
      onChat={onChat}
      onStale={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByText('이 보고서에 관해 대화하기'));
  await view.rerender(
    <DailyReportSavedSection
      saved={{ ...saved, runId: 'two', revision: 2 }}
      feature={feature}
      onChat={onChat}
      onStale={jest.fn()}
    />,
  );
  resolve(saved);
  await Promise.resolve();
  expect(onChat).not.toHaveBeenCalled();
});
