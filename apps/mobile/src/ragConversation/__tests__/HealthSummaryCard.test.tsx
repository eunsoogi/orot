import { fireEvent, render, screen } from '@testing-library/react-native';
import { HealthSummaryCard } from '../HealthSummaryCard';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { OMITTED_SUMMARY_CONTENT_NOTE } from '../../diseaseHypotheses/summaryPartialValidation';
import { INCOMPLETE_SUMMARY_EVIDENCE_NOTE } from '../../diseaseHypotheses/summaryPartialEvidence';

test('shows the admitted period, sections, source and retry without claiming a save', async () => {
  const onOpenSource = jest.fn();
  const onRetry = jest.fn();
  await render(
    <HealthSummaryCard
      result={{
        reference: {
          summaryId: 'id',
          window: {
            fromInclusive: '2026-10-01T00:00:00Z',
            toExclusive: '2026-10-05T00:00:00Z',
            timeZone: 'UTC',
          },
        },
        analysis: {
          hypotheses: [
            {
              title: '수면',
              summary: '수면 기록이에요.',
              uncertainty: '기록이 없는 날은 알 수 없어요.',
              missingData: [],
              supportingEvidence: [reference],
              contraryEvidence: [],
            },
          ],
          savedSummary: { status: 'failed' },
        },
      }}
      onOpenSource={onOpenSource}
      onLinkError={jest.fn()}
      onRetry={onRetry}
    />,
  );
  expect(screen.getByText(/미만 \(UTC\)/)).toBeTruthy();
  expect(screen.getByText('기록이 없는 날은 알 수 없어요.')).toBeTruthy();
  expect(screen.getByText('저장하지 못했어요.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: /원문 근거 열기/ }));
  expect(onOpenSource).toHaveBeenCalledWith(reference);
  await fireEvent.press(screen.getByRole('button', { name: '저장 다시 시도' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('shows incomplete and restored content-review warnings', async () => {
  await render(
    <HealthSummaryCard
      result={{
        reference: {
          summaryId: 'id',
          window: {
            fromInclusive: '2026-10-01T00:00:00Z',
            toExclusive: '2026-10-05T00:00:00Z',
            timeZone: 'UTC',
          },
        },
        analysis: {
          hypotheses: [],
          incompleteEvidence: true,
          omittedUnsupportedContent: true,
          savedSummary: {
            status: 'saved',
            id: 'id',
            modelName: 'Model',
            createdAt: '2026-10-05T00:00:00Z',
            contentReviewIssues: [
              'prescription',
              'sleep_count',
              'sleep_duration',
              'step_unit',
            ],
          },
        },
      }}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
  expect(screen.getByText(OMITTED_SUMMARY_CONTENT_NOTE)).toBeTruthy();
  expect(screen.getByText(INCOMPLETE_SUMMARY_EVIDENCE_NOTE)).toBeTruthy();
  expect(screen.getAllByRole('alert')).toHaveLength(6);
});
