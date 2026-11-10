import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { DailyReportRoute } from '../DailyReportRoute';
import type { createDailyReportFeature } from '../dailyReportFeature';

test('an old reminder only looks up its exact day until today is selected and requested', async () => {
  const old = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
  const lookup = jest.fn(async () => ({ status: 'missing' as const }));
  const preview = jest.fn(async () => ({ status: 'not_today' as const }));
  const start = jest.fn(
    (_identity: ReturnType<typeof createDailyReportIdentity>) => ({
      status: 'started' as const,
      cancel: jest.fn(),
      result: Promise.resolve({ status: 'failed' as const, code: 'cancelled' }),
    }),
  );
  const feature = {
    lookup,
    preview,
    start,
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as ReturnType<typeof createDailyReportFeature>;
  await render(
    <DailyReportRoute
      feature={feature}
      initialIdentity={old}
      reminder
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );
  await waitFor(() => expect(lookup).toHaveBeenCalledWith(old));
  expect(start).not.toHaveBeenCalled();
  expect(screen.queryByText('오늘 요약하기')).toBeNull();
  await fireEvent.press(screen.getByText('오늘 선택하기'));
  await screen.findByText('오늘 요약하기');
  expect(start).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('오늘 요약하기'));
  expect(start).toHaveBeenCalledTimes(1);
  expect(start.mock.calls[0]?.[0].key).not.toBe(old.key);
  expect(await screen.findByText('보고서 생성을 취소했어요.')).toBeTruthy();
});

test('changing days detaches an older run and ignores its later failure', async () => {
  const old = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
  let finish!: (value: { status: 'failed'; code: string }) => void;
  const result = new Promise<{ status: 'failed'; code: string }>(resolve => {
    finish = resolve;
  });
  const cancel = jest.fn();
  const feature = {
    lookup: jest.fn(async () => ({ status: 'missing' as const })),
    preview: jest.fn(async () => ({ status: 'not_today' as const })),
    start: jest.fn(),
    active: jest.fn((identity: typeof old) =>
      identity.key === old.key ? { result, cancel } : null,
    ),
    retain: jest.fn((identity: typeof old) =>
      identity.key === old.key ? cancel : () => {},
    ),
  } as unknown as ReturnType<typeof createDailyReportFeature>;
  await render(
    <DailyReportRoute
      feature={feature}
      initialIdentity={old}
      reminder
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );
  await screen.findByText('보고서를 만들고 있어요.');
  await fireEvent.press(screen.getByText('오늘 선택하기'));
  await screen.findByText('오늘 요약하기');
  expect(screen.queryByText('생성 취소')).toBeNull();
  finish({ status: 'failed', code: 'cancelled' });
  await waitFor(() =>
    expect(screen.queryByText('보고서 생성을 취소했어요.')).toBeNull(),
  );
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('hides the saved report when source revalidation finds it stale', async () => {
  const identity = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
  const lookup = jest
    .fn()
    .mockResolvedValueOnce({
      status: 'saved',
      runId: 'run',
      revision: 1,
      context: { identity, generationCutoff: '2023-11-15T12:00:00Z' },
      report: {
        generatedAt: '2023-11-15T12:01:00Z',
        observations: [{ text: '합성 기록' }],
        coverage: [],
      },
    })
    .mockResolvedValue({ status: 'stale', runId: 'run', revision: 1 });
  const feature = {
    lookup,
    preview: jest.fn(async () => ({ status: 'not_today' as const })),
    start: jest.fn(),
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as ReturnType<typeof createDailyReportFeature>;
  await render(
    <DailyReportRoute
      feature={feature}
      initialIdentity={identity}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
      resolveSources={jest.fn(async () => ({ status: 'stale' as const }))}
      onOpenSource={jest.fn()}
    />,
  );
  await screen.findByText('합성 기록');
  await fireEvent.press(screen.getByText('기록 출처 확인'));
  await screen.findByText(
    '기록이 바뀌어 저장된 보고서를 표시할 수 없어요. 오늘을 선택해 다시 요약할 수 있어요.',
  );
  expect(screen.queryByText('합성 기록')).toBeNull();
});

test('publishes active generation to the navigation guard and cancels when its route unmounts', async () => {
  const identity = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
  const cancel = jest.fn();
  const feature = {
    lookup: jest.fn(async () => ({ status: 'missing' as const })),
    preview: jest.fn(async () => ({ status: 'not_today' as const })),
    start: jest.fn(),
    active: jest.fn(() => ({ cancel, result: new Promise(() => {}) })),
    retain: jest.fn(() => cancel),
  } as unknown as ReturnType<typeof createDailyReportFeature>;
  const onNavigationStateChange = jest.fn();
  const view = await render(
    <DailyReportRoute
      feature={feature}
      initialIdentity={identity}
      navigationRouteKey="route"
      onNavigationStateChange={onNavigationStateChange}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(onNavigationStateChange).toHaveBeenCalledWith(
      'route',
      expect.objectContaining({ hasOngoingOperation: true }),
    ),
  );
  await view.unmount();
  expect(cancel).toHaveBeenCalled();
});

test('an overlay copy can unmount without cancelling the retained report operation', async () => {
  const identity = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
  const cancel = jest.fn();
  const retain = jest.fn(() => cancel);
  const feature = {
    lookup: jest.fn(async () => ({ status: 'missing' as const })),
    preview: jest.fn(async () => ({ status: 'not_today' as const })),
    start: jest.fn(),
    retain,
    active: jest.fn(() => ({ cancel, result: new Promise(() => {}) })),
  } as unknown as ReturnType<typeof createDailyReportFeature>;
  const view = await render(
    <DailyReportRoute
      feature={feature}
      initialIdentity={identity}
      ownsOperation={false}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );
  await screen.findByText('보고서를 만들고 있어요.');
  await view.unmount();
  expect(retain).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

test('opens follow-up with the current report identity only after revalidation', async () => {
  const identity = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
  const saved = {
    status: 'saved' as const,
    runId: 'run',
    revision: 2,
    context: { identity, generationCutoff: '2023-11-15T12:00:00Z' },
    report: {
      generatedAt: '2023-11-15T12:01:00Z',
      observations: [{ text: '합성 기록' }],
      coverage: [],
    },
  };
  const feature = {
    lookup: jest.fn(async () => saved),
    preview: jest.fn(async () => ({ status: 'not_today' as const })),
    start: jest.fn(),
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as ReturnType<typeof createDailyReportFeature>;
  const onChat = jest.fn();
  await render(
    <DailyReportRoute
      feature={feature}
      initialIdentity={identity}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={onChat}
    />,
  );
  await screen.findByText('합성 기록');
  await fireEvent.press(screen.getByText('이 보고서에 관해 대화하기'));
  await waitFor(() =>
    expect(onChat).toHaveBeenCalledWith({
      identity,
      runId: 'run',
      revision: 2,
    }),
  );
  expect(feature.start).not.toHaveBeenCalled();
});
