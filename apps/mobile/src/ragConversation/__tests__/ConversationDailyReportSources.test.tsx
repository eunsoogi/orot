import { createDailyReportIdentity } from '@orot/domain';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DailyReportSourceResolverContext } from '../../aiFeatures/integration/DailyReportSourceLinks';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { ConversationMessage } from '../ConversationMessage';
import { ConversationSources } from '../ConversationSources';

test('restored report starts with the shared compact evidence pill and does not read raw citations', async () => {
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
  const pill = screen.getByTestId(`${id}-sources`);
  const strip = screen.getByTestId(`${id}-citation-strip`);
  expect(pill).toHaveStyle({
    minHeight: 44,
    maxWidth: 210,
    borderRadius: 24,
    paddingVertical: 8,
  });
  expect(strip.props.horizontal).toBe(true);
  expect(strip.props.keyboardShouldPersistTaps).toBe('handled');

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

test('a verified report source pill opens the normal detail callback and shares the ordinary row styling', async () => {
  const identity = createDailyReportIdentity('2035-02-01', 'UTC');
  const guarded = { ...reference, evidenceId: 'verified-source' };
  const resolve = jest.fn(async () => ({
    status: 'current' as const,
    sources: [guarded],
    presentation: { statistics: [], directSources: [0], otherSources: [] },
  }));
  const open = jest.fn();
  const onError = jest.fn();
  const id = 'rag-conversation-message-13-report';
  await render(
    <DailyReportSourceResolverContext.Provider value={resolve}>
      <ConversationSources
        references={[reference]}
        testIDPrefix="ordinary"
        onOpenSource={open}
        onLinkError={onError}
      />
      <ConversationMessage
        message={{
          id: 13,
          role: 'assistant',
          content: '합성 일일 보고서',
          dailyReport: { identity, runId: 'synthetic', revision: 5 },
        }}
        onOpenSource={open}
        onLinkError={onError}
      />
    </DailyReportSourceResolverContext.Provider>,
  );
  expect(resolve).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId(`${id}-sources`));
  const member = screen.getByTestId(`${id}-individual-member-0`);
  const ordinary = screen.getByTestId('ordinary-citation-0');
  expect(member.props.style).toEqual(ordinary.props.style);
  expect(member.props.accessibilityRole).toBe('button');
  await fireEvent.press(member);
  expect(resolve).toHaveBeenNthCalledWith(
    2,
    identity,
    'synthetic',
    5,
    expect.any(AbortSignal),
    undefined,
  );
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith(guarded);
  expect(onError).not.toHaveBeenCalled();
});
