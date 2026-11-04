import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence, hypothesis, reference } from '../taskTestSupport';

test('an omitted section containing a correct anchor cannot authorize a different retained value', () => {
  const content =
    'health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"step_count","value":{"kind":"quantity","amount":1234,"unit":"count"}},{"kind":"health_observation","concept":"heart_rate","value":{"kind":"quantity","amount":76,"unit":"count/min"}}]}';
  const section = hypothesis({
    title: '기록',
    supportingEvidence: [reference.evidenceId],
    uncertainty: '',
    missingData: [],
  });
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        { ...section, summary: '걸음 수는 1234회, 심박수는 76회/분이에요.' },
        {
          ...section,
          summary: '걸음 수는 1234걸음이고 심박수는 999회/분이에요.',
        },
      ],
    } as never,
    {
      request: '기록 요약',
      evidence: { ...evidence, items: [{ ...reference, content }] },
    },
  );
  expect(result.status).toBe('invalid');
});
