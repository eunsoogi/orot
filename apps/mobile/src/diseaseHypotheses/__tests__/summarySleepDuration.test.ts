import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence, hypothesis, reference } from '../taskTestSupport';

const content =
  'health_overview: {"topic":"sleep","records":[{"kind":"health_observation","sourceSemantics":{"sleepStage":"코어 수면","intervalScope":"single_sample_not_nightly_total","intervalDurationSeconds":1795.361}},{"kind":"health_observation","sourceSemantics":{"sleepStage":"렘 수면","intervalScope":"single_sample_not_nightly_total","intervalDurationSeconds":1555.986}}]}';
function validate(summary: string) {
  return symptomSummaryTask.validateResult(
    {
      sections: [
        hypothesis({
          summary,
          supportingEvidence: [reference.evidenceId],
          uncertainty: '',
          missingData: [],
        }),
      ],
    },
    {
      request: '합성 수면 기록 요약',
      evidence: { ...evidence, items: [{ ...reference, content }] },
    },
  );
}

test('rejects minute/second conversion that differs from the cited individual interval', () => {
  expect(
    validate('코어 수면 29분 35초, 렘 수면 25분 35초가 기록됐어요.').status,
  ).toBe('invalid');
});

test.each([
  '코어 수면 29분 55초, 렘 수면 25분 56초가 기록됐어요.',
  '코어 수면 1795.361초, 렘 수면 1555.986초가 기록됐어요.',
  '코어 수면 29분 55.361초, 렘 수면 25분 55.986초가 기록됐어요.',
])(
  'preserves source durations including ordinary whole-second rounding: %s',
  summary => {
    expect(validate(summary).status).toBe('valid');
  },
);

test('does not confuse an explicit start clock time with an interval duration', () => {
  expect(
    validate(
      '코어 수면은 10시 55분 16초에 시작했고, 구간 길이는 29분 55초예요.',
    ).status,
  ).toBe('valid');
});
