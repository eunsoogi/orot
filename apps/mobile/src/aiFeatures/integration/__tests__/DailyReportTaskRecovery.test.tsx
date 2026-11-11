import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { DailyReportRoute } from '../DailyReportRoute';
import type { createDailyReportFeature } from '../dailyReportFeature';
import { todayIdentity } from '../dailyReportTodayIdentity';

type Feature = ReturnType<typeof createDailyReportFeature>;

test('retries retaining a committed regeneration without invoking the provider again', async () => {
  let generated = false;
  let rejectSave!: (error: Error) => void;
  const firstSave = new Promise<void>((_resolve, reject) => {
    rejectSave = reject;
  });
  const retain = jest
    .fn()
    .mockReturnValueOnce(firstSave)
    .mockResolvedValueOnce(undefined);
  const feature = {
    lookup: jest.fn(
      async (identity: ReturnType<typeof createDailyReportIdentity>) => ({
        status: 'saved',
        runId: generated ? 'new' : 'old',
        revision: generated ? 3 : 2,
        context: { identity, generationCutoff: '2026-11-11T00:00:00Z' },
        report: {
          generatedAt: '2026-11-11T00:00:00Z',
          observations: [],
          supportedContext: [],
          followUpQuestions: [],
          coverage: [],
        },
      }),
    ),
    preview: jest.fn(async () => ({ status: 'not_today' })),
    start: jest.fn(() => {
      generated = true;
      return {
        status: 'started',
        cancel: jest.fn(),
        result: Promise.resolve({ status: 'completed', runId: 'new' }),
      };
    }),
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as Feature;
  const today = todayIdentity()!;
  await render(
    <DailyReportRoute
      feature={feature}
      initialIdentity={today}
      expectedReport={{ identity: today, runId: 'old', revision: 2 }}
      taskRevision={2}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
      onTaskResult={retain}
    />,
  );
  await fireEvent.press(await screen.findByText('다시 요약하기'));
  await waitFor(() => expect(retain).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('다시 요약하기')).toBeNull();
  await act(async () => rejectSave(new Error('storage unavailable')));
  await fireEvent.press(await screen.findByText('다시 확인'));
  await waitFor(() => expect(retain).toHaveBeenCalledTimes(2));
  expect(retain).toHaveBeenLastCalledWith({
    identity: today,
    runId: 'new',
    revision: 3,
  });
  expect(feature.start).toHaveBeenCalledTimes(1);
});

test('a completion keeps the card owner captured when generation started', async () => {
  let finish!: (value: { status: 'completed'; runId: string }) => void;
  let generated = false;
  const result = new Promise<{ status: 'completed'; runId: string }>(
    resolve => {
      finish = resolve;
    },
  );
  const feature = {
    lookup: jest.fn(
      async (identity: ReturnType<typeof createDailyReportIdentity>) =>
        generated
          ? {
              status: 'saved',
              runId: 'run',
              revision: 1,
              context: { identity, generationCutoff: '2026-11-11T00:00:00Z' },
              report: {
                generatedAt: '2026-11-11T00:00:00Z',
                observations: [],
                supportedContext: [],
                followUpQuestions: [],
                coverage: [],
              },
            }
          : { status: 'missing' },
    ),
    preview: jest.fn(async () => ({ status: 'not_today' })),
    start: jest.fn(() => ({ status: 'started', cancel: jest.fn(), result })),
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as Feature;
  const original = jest.fn(async () => {});
  const replacement = jest.fn(async () => {});
  const props = {
    feature,
    providerSelection: null,
    onBack: jest.fn(),
    onChat: jest.fn(),
  };
  const view = await render(
    <DailyReportRoute {...props} onTaskResult={original} />,
  );
  await fireEvent.press(await screen.findByText('오늘 요약하기'));
  await view.rerender(
    <DailyReportRoute {...props} onTaskResult={replacement} />,
  );
  generated = true;
  await act(async () => finish({ status: 'completed', runId: 'run' }));
  await waitFor(() => expect(original).toHaveBeenCalledTimes(1));
  expect(replacement).not.toHaveBeenCalled();
});

test('a reopened stale task can explicitly reconnect the current saved revision', async () => {
  const identity = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
  const retain = jest.fn(async () => {});
  const feature = {
    lookup: jest.fn(async () => ({
      status: 'saved',
      runId: 'new',
      revision: 3,
      context: { identity, generationCutoff: '2023-11-15T00:00:00Z' },
      report: {
        generatedAt: '2023-11-15T00:00:00Z',
        observations: [],
        supportedContext: [],
        followUpQuestions: [],
        coverage: [],
      },
    })),
    preview: jest.fn(async () => ({ status: 'not_today' })),
    start: jest.fn(),
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as Feature;
  await render(
    <DailyReportRoute
      feature={feature}
      initialIdentity={identity}
      expectedReport={{ identity, runId: 'old', revision: 2 }}
      taskRevision={2}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
      onTaskResult={retain}
    />,
  );
  await fireEvent.press(await screen.findByText('최신 저장 보고서 연결하기'));
  await waitFor(() =>
    expect(retain).toHaveBeenCalledWith({
      identity,
      runId: 'new',
      revision: 3,
    }),
  );
  expect(feature.start).not.toHaveBeenCalled();
});
