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
import { retainDailyReportResult } from '../retainDailyReportResult';

type Feature = ReturnType<typeof createDailyReportFeature>;

test('an explicit generation retains its exact saved result without starting a chat', async () => {
  let generated = false;
  const onTaskResult = jest.fn(async () => {});
  const onChat = jest.fn();
  const feature = {
    lookup: jest.fn(
      async (identity: ReturnType<typeof createDailyReportIdentity>) =>
        generated
          ? {
              status: 'saved',
              runId: 'run',
              revision: 3,
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
    start: jest.fn(() => {
      generated = true;
      return {
        status: 'started',
        cancel: jest.fn(),
        result: Promise.resolve({ status: 'completed', runId: 'run' }),
      };
    }),
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as Feature;
  await render(
    <DailyReportRoute
      feature={feature}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={onChat}
      onTaskResult={onTaskResult}
    />,
  );
  await fireEvent.press(await screen.findByText('오늘 요약하기'));
  await waitFor(() =>
    expect(onTaskResult).toHaveBeenCalledWith({
      identity: expect.objectContaining({ kind: 'daily_report' }),
      runId: 'run',
      revision: 3,
    }),
  );
  expect(onChat).not.toHaveBeenCalled();
});

test.each([
  { status: 'saved', runId: 'replacement', revision: 4 },
  { status: 'stale', runId: 'run', revision: 3 },
  { status: 'deleted' },
])('does not retain a replaced or invalidated result: %o', async lookup => {
  const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  const feature = { lookup: jest.fn(async () => lookup) } as unknown as Feature;
  const retain = jest.fn();
  await retainDailyReportResult(feature, identity, 'run', retain);
  expect(retain).not.toHaveBeenCalled();
});

test('waits for the existing report reference before allowing regeneration', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => {
    finish = resolve;
  });
  const retain = jest.fn(() => pending);
  const feature = {
    lookup: jest.fn(
      async (identity: ReturnType<typeof createDailyReportIdentity>) => ({
        status: 'saved',
        runId: 'old',
        revision: 2,
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
    start: jest.fn(),
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as Feature;
  await render(
    <DailyReportRoute
      feature={feature}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
      onTaskResult={retain}
      taskRevision={1}
    />,
  );
  await waitFor(() => expect(retain).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('다시 요약하기')).toBeNull();
  await act(async () => finish());
  expect(await screen.findByText('다시 요약하기')).toBeTruthy();
  expect(feature.start).not.toHaveBeenCalled();
});
