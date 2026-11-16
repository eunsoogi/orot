import { act, render, waitFor } from '@testing-library/react-native';
import { DailyReportRoute } from '../DailyReportRoute';
import type { createDailyReportFeature } from '../dailyReportFeature';

type Feature = ReturnType<typeof createDailyReportFeature>;
function feature() {
  return {
    lookup: jest.fn(async () => ({ status: 'missing' })),
    preview: jest.fn(async () => ({ status: 'not_today' })),
    start: jest.fn((..._args: Parameters<Feature['start']>) => ({
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

test('a live one-shot choice uses normal report generation once after readiness', async () => {
  const service = feature();
  const claim = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
  const props = {
    feature: service as unknown as Feature,
    providerSelection: null,
    onBack: jest.fn(),
    onChat: jest.fn(),
    claimRequestedStart: claim,
  };
  const view = await render(<DailyReportRoute {...props} />);
  await waitFor(() => expect(service.start).toHaveBeenCalledTimes(1));
  await view.rerender(<DailyReportRoute {...props} />);
  expect(service.start).toHaveBeenCalledTimes(1);
  expect(service.start.mock.calls[0]?.[1]).toEqual({
    kind: 'reuse_or_generate',
  });
});

test('ordinary restored mounting and revoked live authority never start generation', async () => {
  const service = feature();
  const props = {
    feature: service as unknown as Feature,
    providerSelection: null,
    onBack: jest.fn(),
    onChat: jest.fn(),
  };
  const view = await render(<DailyReportRoute {...props} />);
  await waitFor(() => expect(service.lookup).toHaveBeenCalled());
  expect(service.start).not.toHaveBeenCalled();
  const claim = jest.fn(() => false);
  await view.rerender(
    <DailyReportRoute {...props} claimRequestedStart={claim} />,
  );
  await waitFor(() => expect(claim).toHaveBeenCalled());
  expect(service.start).not.toHaveBeenCalled();
});

test('a repeated tap during an active run cannot queue a retry after failure', async () => {
  const service = feature();
  let finish!: (value: { status: string; code: string }) => void;
  service.start.mockImplementation(() => ({
    status: 'started',
    cancel: jest.fn(),
    result: new Promise(resolve => {
      finish = resolve;
    }),
  }));
  const props = {
    feature: service as unknown as Feature,
    providerSelection: null,
    onBack: jest.fn(),
    onChat: jest.fn(),
  };
  const first = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
  const view = await render(
    <DailyReportRoute {...props} claimRequestedStart={first} />,
  );
  await waitFor(() => expect(service.start).toHaveBeenCalledTimes(1));
  const second = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
  await view.rerender(
    <DailyReportRoute {...props} claimRequestedStart={second} />,
  );
  await waitFor(() => expect(second).toHaveBeenCalled());
  await act(async () => {
    finish({ status: 'failed', code: 'provider_unavailable' });
  });
  expect(service.start).toHaveBeenCalledTimes(1);
});
