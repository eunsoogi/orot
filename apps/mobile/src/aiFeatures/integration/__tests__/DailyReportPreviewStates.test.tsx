import { act, render, screen } from '@testing-library/react-native';
import type { createDailyReportIdentity } from '@orot/domain';
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
    timeZone: 'Asia/Seoul',
    count: 0,
    partial: false,
    coverage: [],
    sourceCounts: new Map(),
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
