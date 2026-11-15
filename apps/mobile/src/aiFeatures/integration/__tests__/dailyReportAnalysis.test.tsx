import { render, screen } from '@testing-library/react-native';
import { DailyReportOutputSchema } from '@orot/domain';
import { DailyReportAnalysis } from '../DailyReportAnalysis';
import { dailyReportAnalysis } from '../dailyReportAnalysis';
import { dailyReportGuidance } from '../dailyReportGuidance';
import { calendarTestObservation } from '../testSupport/dailyReportCalendarTestFixture';

test('severe readings lead, all historical and plan citations survive composition', () => {
  const record = {
    ...calendarTestObservation,
    concept: 'blood_pressure_systolic',
    value: { kind: 'quantity' as const, amount: 190, unit: 'mmHg' },
  };
  const values = [{ kind: 'health_observation' as const, record }];
  const sources = [{ source: 'health_observation', recordId: record.id }];
  const historical = {
    text: '합성 과거 비교',
    sourceReferences: [{ source: 'health_observation', recordId: 'past' }],
  };
  const plan = {
    text: '합성 제목 일치 계획; 수행 확인 아님',
    sourceReferences: [{ source: 'system_calendar', recordId: 'plan' }],
  };
  const claims = dailyReportAnalysis(
    values,
    sources as never,
    [],
    [historical],
    [plan],
  );
  expect(claims[0]).toEqual({
    ...dailyReportGuidance(values, sources as never)[0],
    section: 'priority',
  });
  expect(claims[0]!.text).toContain('119');
  expect(claims.find(item => item.section === 'history')).toEqual({
    ...historical,
    section: 'history',
  });
  expect(claims.find(item => item.section === 'plans')).toEqual({
    ...plan,
    section: 'plans',
  });
  expect(claims.every(item => item.sourceReferences.length)).toBe(true);
});

test('sectioned output retains schema validation while legacy output needs no new metadata', () => {
  const output = {
    schemaVersion: 1,
    identity: { reportDate: '2035-01-01', timeZone: 'UTC' },
    generatedAt: '2035-01-01T12:00:00Z',
    observations: [],
    supportedContext: [
      {
        text: '보존된 원문',
        sourceReferences: [{ source: 'dose_event', recordId: 'dose' }],
      },
    ],
    coverage: [],
    followUpQuestions: [],
  };
  // Reuse the schema's identity contract rather than loosening citation validation.
  const claimSchema = DailyReportOutputSchema.shape.supportedContext;
  expect(claimSchema.safeParse(output.supportedContext).success).toBe(true);
  expect(
    claimSchema.safeParse([
      { ...output.supportedContext[0], section: 'priority' },
    ]).success,
  ).toBe(true);
  expect(
    claimSchema.safeParse([
      { ...output.supportedContext[0], section: 'normal' },
    ]).success,
  ).toBe(false);
  expect(
    claimSchema.safeParse([
      { ...output.supportedContext[0], sourceReferences: [] },
    ]).success,
  ).toBe(false);
});

test('analysis is visible in stored order and legacy wording is not retrospectively classified', async () => {
  const ref = [{ source: 'health_observation', recordId: 'synthetic' }];
  const view = await render(
    <DailyReportAnalysis
      claims={[
        { text: '합성 긴급 안내', sourceReferences: ref, section: 'priority' },
        { text: '합성 과거 해석', sourceReferences: ref, section: 'history' },
      ]}
    />,
  );
  expect(screen.getByText('합성 긴급 안내')).toBeTruthy();
  expect(
    screen.getAllByRole('header').map(item => item.props.children),
  ).toEqual([
    '오늘 건강 요약',
    '먼저 확인할 건강 신호와 실천',
    '평소 기록과 함께 본 변화',
  ]);
  await view.rerender(
    <DailyReportAnalysis
      claims={[{ text: '이전 원문 그대로', sourceReferences: ref }]}
    />,
  );
  expect(screen.getByText('이전 원문 그대로')).toBeTruthy();
  expect(screen.queryByText('먼저 확인할 건강 신호와 실천')).toBeNull();
});
