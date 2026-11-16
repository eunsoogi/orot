import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../../storage/localDataClearEvents';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { ConversationSavedReportMessage } from '../ConversationSavedReportMessage';
import type { AiFeatureServices } from '../featureServices';

const target = {
  identity: createDailyReportIdentity('2035-01-01', 'UTC')!,
  runId: 'synthetic',
  revision: 1,
};
function services() {
  const start = jest.fn();
  const lookup = jest.fn().mockResolvedValue({
    status: 'saved',
    runId: target.runId,
    revision: 1,
    context: {
      identity: target.identity,
      generationCutoff: '2035-01-01T12:00:00Z',
    },
    report: {
      coverage: [],
      followUpQuestions: [],
      supportedContext: [{ text: 'Synthetic saved analysis' }],
      observations: [],
    },
  });
  const sources = jest
    .fn()
    .mockResolvedValue({ status: 'current', sources: [] });
  return {
    start,
    lookup,
    sources,
    value: {
      dailyReport: { start, lookup },
      dailyReportSources: sources,
    } as unknown as AiFeatureServices,
  };
}

test('restores a report as an assistant message without a generator form or inference', async () => {
  const fixture = services();
  await render(
    <ConversationSavedReportMessage
      target={target}
      services={fixture.value}
      onOpenSource={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText(/Synthetic saved analysis/)).toBeTruthy(),
  );
  expect(screen.getByTestId('conversation-assistant-message')).toBeTruthy();
  expect(screen.queryByTestId('daily-report-screen')).toBeNull();
  expect(screen.queryByTestId('inline-daily-report-task')).toBeNull();
  expect(fixture.start).not.toHaveBeenCalled();
});

test.each(['deleted', 'stale', 'error'])(
  'a %s report never exposes stale saved prose',
  async status => {
    const fixture = services();
    fixture.lookup.mockResolvedValue({ status });
    await render(
      <ConversationSavedReportMessage
        target={target}
        services={fixture.value}
        onOpenSource={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('conversation-assistant-message')).toBeTruthy(),
    );
    expect(screen.queryByText(/Synthetic saved analysis/)).toBeNull();
    expect(fixture.sources).not.toHaveBeenCalled();
    expect(fixture.start).not.toHaveBeenCalled();
  },
);

test.each([notifyLocalDataCleared, notifyLocalSourceDeleted])(
  'committed deletion clears an already visible body before reread finishes',
  async notify => {
    const fixture = services();
    await render(
      <ConversationSavedReportMessage
        target={target}
        services={fixture.value}
        onOpenSource={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Synthetic saved analysis/)).toBeTruthy(),
    );
    let finish!: (value: unknown) => void;
    fixture.lookup.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      }),
    );
    await act(() => notify());
    expect(screen.queryByText(/Synthetic saved analysis/)).toBeNull();
    await act(() => finish({ status: 'deleted' }));
    expect(screen.queryByText(/Synthetic saved analysis/)).toBeNull();
    expect(fixture.start).not.toHaveBeenCalled();
  },
);

test('deletion fences an old source resolver so late completion cannot resurrect the report', async () => {
  const fixture = services();
  let finish!: (value: unknown) => void;
  fixture.sources.mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  await render(
    <ConversationSavedReportMessage
      target={target}
      services={fixture.value}
      onOpenSource={jest.fn()}
    />,
  );
  await waitFor(() => expect(fixture.sources).toHaveBeenCalledTimes(1));
  const oldSignal = fixture.sources.mock.calls[0][3] as AbortSignal;
  fixture.lookup.mockResolvedValue({ status: 'deleted' });
  await act(() => notifyLocalSourceDeleted());
  expect(oldSignal.aborted).toBe(true);
  await act(() => finish({ status: 'current', sources: [] }));
  expect(screen.queryByText(/Synthetic saved analysis/)).toBeNull();
  expect(fixture.start).not.toHaveBeenCalled();
});
