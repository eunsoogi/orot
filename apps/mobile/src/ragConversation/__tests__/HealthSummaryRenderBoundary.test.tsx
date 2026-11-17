import { fireEvent, render, screen } from '@testing-library/react-native';
import { HealthSummaryCard } from '../HealthSummaryCard';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import type { HealthSummaryResult } from '../healthSummary';
const mockProseRender = jest.fn();
jest.mock('../../layout/AppText', () => {
  const React = require('react');
  const Actual = jest.requireActual('../../layout/AppText').AppText;
  return {
    AppText: (props: { children: unknown }) => {
      if (
        typeof props.children === 'string' &&
        props.children.startsWith('Synthetic')
      )
        mockProseRender(props.children);
      return React.createElement(Actual, props);
    },
  };
});
const result: HealthSummaryResult = {
  reference: {
    summaryId: 'synthetic',
    window: {
      fromInclusive: '2026-10-01',
      toExclusive: '2026-10-02',
      timeZone: 'UTC',
    },
  },
  analysis: {
    hypotheses: [
      {
        title: 'Synthetic title',
        summary: 'Synthetic prose '.repeat(100),
        uncertainty: 'Synthetic uncertainty',
        missingData: ['Synthetic missing'],
        supportingEvidence: [reference],
        contraryEvidence: [],
      },
    ],
    savedSummary: { status: 'failed' },
  },
};
// Counts JS text entries only, not native layout work or physical-device frame rate.
test('unchanged summary prose does not re-enter on parent updates while sources and retry stay current', async () => {
  const oldOpen = jest.fn(),
    nextOpen = jest.fn(),
    oldRetry = jest.fn(),
    nextRetry = jest.fn();
  const card = (open: typeof oldOpen, retry: typeof oldRetry) => (
    <HealthSummaryCard
      result={result}
      onOpenSource={open}
      onLinkError={() => {}}
      onRetry={retry}
    />
  );
  const view = await render(card(oldOpen, oldRetry));
  mockProseRender.mockClear();
  for (let i = 0; i < 12; i++) await view.rerender(card(nextOpen, nextRetry));
  expect(mockProseRender).toHaveBeenCalledTimes(0);
  await fireEvent.press(screen.getByRole('button', { name: /원문 근거 열기/ }));
  await fireEvent.press(screen.getByRole('button', { name: '저장 다시 시도' }));
  expect(nextOpen).toHaveBeenCalledWith(reference);
  expect(nextRetry).toHaveBeenCalledTimes(1);
  expect(oldOpen).not.toHaveBeenCalled();
  expect(oldRetry).not.toHaveBeenCalled();
});
test('replacement, missing-data removal and warnings remain live', async () => {
  const view = await render(
    <HealthSummaryCard
      result={result}
      onOpenSource={() => {}}
      onLinkError={() => {}}
    />,
  );
  const changed = {
    ...result,
    analysis: {
      ...result.analysis,
      incompleteEvidence: true,
      hypotheses: [
        {
          ...result.analysis.hypotheses[0]!,
          summary: 'Synthetic replacement',
          uncertainty: '',
          missingData: [],
        },
      ],
    },
  };
  await view.rerender(
    <HealthSummaryCard
      result={changed}
      onOpenSource={() => {}}
      onLinkError={() => {}}
    />,
  );
  expect(screen.getByText('Synthetic replacement')).toBeTruthy();
  expect(screen.queryByText('Synthetic uncertainty')).toBeNull();
  expect(screen.queryByText('Synthetic missing')).toBeNull();
  expect(screen.getByTestId('health-summary-incomplete')).toBeTruthy();
});
