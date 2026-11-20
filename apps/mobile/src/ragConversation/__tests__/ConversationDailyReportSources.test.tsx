import { createDailyReportIdentity } from '@orot/domain';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DailyReportSourceResolverContext } from '../../aiFeatures/integration/DailyReportSourceLinks';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { ConversationMessage } from '../ConversationMessage';

test('restored report opens a single lazy evidence button without raw citation counts', async () => {
  const identity = createDailyReportIdentity('2035-01-01', 'UTC');
  const sources = Array.from({ length: 120 }, (_, index) => ({
    ...reference,
    evidenceId: `synthetic-${index}`,
  }));
  const resolve = jest
    .fn()
    .mockResolvedValueOnce({
      status: 'current',
      sources,
      presentation: {
        statistics: [sources.map((_source, index) => index)],
        directSources: [],
        otherSources: [],
      },
    })
    .mockResolvedValueOnce({ status: 'deleted' });
  const onOpenSource = jest.fn();
  const onLinkError = jest.fn();
  const id = 'rag-conversation-message-2-report';
  const view = await render(
    <DailyReportSourceResolverContext.Provider value={resolve}>
      <ConversationMessage
        onOpenSource={onOpenSource}
        onLinkError={onLinkError}
        message={{
          id: 2,
          role: 'assistant',
          content: '합성 보고서',
          restoredHistory: true,
          dailyReport: { identity, runId: 'report', revision: 1 },
          citations: sources,
        }}
      />
    </DailyReportSourceResolverContext.Provider>,
  );
  expect(resolve).not.toHaveBeenCalled();
  expect(screen.queryByText('+118')).toBeNull();
  await fireEvent.press(screen.getByTestId(`${id}-sources`));
  const statistic = await screen.findByTestId(`${id}-statistic-0`);
  expect(resolve).toHaveBeenCalledWith(
    identity,
    'report',
    1,
    expect.any(AbortSignal),
    'presentation',
  );
  expect(screen.queryByTestId(`${id}-statistic-1`)).toBeNull();
  expect(screen.queryByTestId(`${id}-statistic-0-member-0`)).toBeNull();
  await fireEvent.press(statistic);
  await fireEvent.press(screen.getByTestId(`${id}-statistic-0-member-0`));
  expect(onOpenSource).not.toHaveBeenCalled();
  expect(onLinkError).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId(`${id}-statistic-0`)).toBeNull();
  expect(screen.queryByText('합성 보고서')).toBeNull();
  await view.unmount();
});
