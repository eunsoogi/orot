import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { t } from '../../../i18n';
import { createDailyReportIdentity } from '@orot/domain';
import { ConversationReportTask } from '../ConversationReportTask';
import { parseTask } from '../../../storage/conversationTaskCardCodec';
import type { AiFeatureServices } from '../featureServices';

const identity = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
const task = {
  kind: 'daily_report' as const,
  identity,
  reminder: true as const,
};

test('the identifier-only reminder discriminator survives encoding without accepting extra payload', () => {
  expect(parseTask(JSON.parse(JSON.stringify(task)))).toEqual(task);
  expect(parseTask({ ...task, reminder: false })).toBeNull();
  expect(parseTask({ ...task, reminder: 'true' })).toBeNull();
  expect(parseTask({ ...task, health: 'synthetic' })).toBeNull();
  expect(parseTask({ kind: 'daily_report', identity })).toEqual({
    kind: 'daily_report',
    identity,
  });
});

function setup() {
  const dailyReport = {
    lookup: jest.fn().mockResolvedValue({ status: 'missing' }),
    preview: jest.fn(async () => ({ status: 'not_today' as const })),
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
    start: jest.fn(),
  };
  const services = {
    dailyReport,
    sendRagMessage: jest.fn(),
  } as unknown as AiFeatureServices;
  const onTaskIdentity = jest.fn(async (_identity: typeof identity) => {});
  const props = {
    card: {
      id: 'reminder',
      createdAt: '2023-11-15T12:00:00Z',
      revision: 1,
      task,
    },
    services,
    sessionId: 1,
    onTaskIdentity,
    onTaskResult: jest.fn(async () => {}),
    onBack: jest.fn(),
    onChat: jest.fn(),
    onOpenSource: jest.fn(),
  };
  return { dailyReport, services, props };
}

test('a retained historical reminder reads its exact identity without dispatch and persists explicit today selection', async () => {
  const { dailyReport, services, props } = setup();
  await render(<ConversationReportTask {...props} />);
  await waitFor(() =>
    expect(dailyReport.lookup).toHaveBeenCalledWith(identity),
  );
  expect(screen.getByTestId('inline-daily-report-task')).toBeTruthy();
  expect(screen.getByText(t('dailyReport.reminderZone'))).toBeTruthy();
  expect(screen.queryByText('오늘 요약하기')).toBeNull();
  expect(dailyReport.start).not.toHaveBeenCalled();
  expect(services.sendRagMessage).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('오늘 선택하기'));
  await screen.findByText('오늘 요약하기');
  expect(
    props.onTaskIdentity.mock.calls.some(
      ([value]) => value.key !== identity.key,
    ),
  ).toBe(true);
  expect(dailyReport.start).not.toHaveBeenCalled();
  expect(services.sendRagMessage).not.toHaveBeenCalled();
});

test('ordinary date-only cards keep their existing presentation', async () => {
  const { dailyReport, props } = setup();
  await render(
    <ConversationReportTask
      {...props}
      card={{ ...props.card, task: { kind: 'daily_report', identity } }}
    />,
  );
  expect(screen.queryByTestId('inline-daily-report-task')).toBeNull();
  expect(screen.getByText('오늘 선택하기')).toBeTruthy();
  expect(dailyReport.lookup).not.toHaveBeenCalled();
});

test('historical saved lookup retains the exact result and forwards deliberate chat', async () => {
  const { dailyReport, props } = setup();
  const target = { identity, runId: 'synthetic-run', revision: 2 };
  dailyReport.lookup.mockResolvedValue({
    status: 'saved',
    ...target,
    context: { identity, generationCutoff: '2023-11-15T12:00:00Z' },
    report: {
      generatedAt: '2023-11-15T12:01:00Z',
      observations: [],
      supportedContext: [],
      followUpQuestions: [],
      coverage: [],
    },
  });
  await render(<ConversationReportTask {...props} ownsOperation={false} />);
  await waitFor(() => expect(props.onTaskResult).toHaveBeenCalledWith(target));
  await fireEvent.press(screen.getByText(t('dailyReport.chat')));
  await waitFor(() => expect(props.onChat).toHaveBeenCalledWith(target));
  expect(dailyReport.start).not.toHaveBeenCalled();
});

test('failed explicit today persistence leaves the historical card selected', async () => {
  const { dailyReport, props } = setup();
  props.onTaskIdentity.mockImplementation(async value => {
    if (value.key !== identity.key) throw new Error('Synthetic save failure');
  });
  await render(<ConversationReportTask {...props} />);
  await waitFor(() =>
    expect(dailyReport.lookup).toHaveBeenCalledWith(identity),
  );
  await fireEvent.press(screen.getByText('오늘 선택하기'));
  expect(screen.queryByText('오늘 요약하기')).toBeNull();
  expect(
    dailyReport.lookup.mock.calls.every(
      ([value]) => value.key === identity.key,
    ),
  ).toBe(true);
  expect(dailyReport.start).not.toHaveBeenCalled();
});
