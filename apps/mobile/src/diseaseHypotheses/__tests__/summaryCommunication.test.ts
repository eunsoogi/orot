import { symptomSummaryTask } from '../symptomSummaryTask';
import { partitionedSymptomSummaryTask } from '../partitionedSymptomSummaryTask';
import { SUMMARY_COMMUNICATION_REASON } from '../summaryCommunication';
import { evidence, hypothesis, reference } from '../taskTestSupport';
import { validateDiseaseHypothesisResult } from '../resultValidation';

const content =
  'health_overview: {"topic":"medications","records":[{"kind":"medication_definition","displayText":"합성약","hasSchedule":true}]}';
const input = {
  request: '기록된 건강 정보를 간결하게 요약해 주세요.',
  evidence: { ...evidence, items: [{ ...reference, content }] },
};
const section = (summary: string, uncertainty = '') =>
  hypothesis({
    title: '등록된 약',
    summary,
    uncertainty,
    missingData: [],
    supportingEvidence: [reference.evidenceId],
  });

test.each([
  '반환 자료의 용량 제한으로 일부 내용을 포함하지 못했어요.',
  '도구 결과 크기 한도에 도달했어요.',
  'payload 한도 때문에 일부 항목이 빠졌어요.',
  '토큰 예산 제한 때문에 일부 내용을 제외했어요.',
  'period_detail_exceeds_payload_limit 때문에 일부 내용을 제외했어요.',
])(
  'corrects internal terminology without rewriting saved summaries: %s',
  note => {
    const value = section('합성약이 건강 앱에 등록되어 있어요.', note);
    expect(
      validateDiseaseHypothesisResult({ hypotheses: [value] }, input, {
        allowEmptyUncertainty: true,
      }).status,
    ).toBe('valid');
    expect(
      symptomSummaryTask.validateResult({ sections: [value] }, input),
    ).toMatchObject({
      status: 'invalid',
      reason: SUMMARY_COMMUNICATION_REASON,
    });
    expect(
      symptomSummaryTask.correctionInstructionForInvalidResult?.(
        SUMMARY_COMMUNICATION_REASON,
      ),
    ).toContain('Keep the summary explicitly partial');
  },
);

test('preserves partial coverage, concise limitations and explicit source facts', () => {
  const partial = {
    ...input,
    evidence: {
      ...input.evidence,
      coverage: [
        {
          ...evidence.coverage[0]!,
          truncated: true,
          gaps: [
            'period_detail_exceeds_payload_limit_choose_fewer_topics_or_summary',
          ],
        },
      ],
    },
  };
  const note =
    '일부 요청한 정보는 이번 요약에 포함하지 못했어요. 기록이 없다는 뜻은 아니에요.';
  const result = symptomSummaryTask.validateResult(
    {
      sections: [section('합성약이 건강 앱에 등록되어 있어요.', note)],
    },
    partial,
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.hypotheses[0]!.uncertainty).toBe(note);
    expect(result.value.hypotheses[0]!.supportingEvidence[0]!.evidenceId).toBe(
      reference.evidenceId,
    );
  }
  const message = symptomSummaryTask.createMessages!(partial)[0]!;
  if (message.role !== 'user') throw new Error('Expected user facts');
  expect(JSON.parse(String(message.content)).coverage).toEqual(
    partial.evidence.coverage,
  );
});

test('keeps documented skipped doses and actual medication uncertainty visible', () => {
  const skipped = content.replace(
    ']}',
    ',{"kind":"dose_event","eventKind":"skipped","medicationName":"합성약"}]}',
  );
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        section(
          '합성약이 등록되어 있고 복용을 건너뛴 기록이 있어요.',
          '개별 기록만으로 이후 복용 상태를 알 수는 없어요.',
        ),
      ],
    },
    {
      ...input,
      evidence: {
        ...input.evidence,
        items: [{ ...reference, content: skipped }],
      },
    },
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid')
    expect(result.value.hypotheses[0]!.summary).toContain('건너뛴 기록');
});

test('guides both provider paths away from routine nonadherence boilerplate without hiding facts', () => {
  for (const task of [symptomSummaryTask, partitionedSymptomSummaryTask]) {
    expect(task.systemPrompt).toContain('Do not add a routine disclaimer');
    expect(task.systemPrompt).toContain(
      'Preserve explicitly recorded skipped doses',
    );
    expect(task.systemPrompt).toContain('Do not say records are absent');
  }
});

test('withholds technical draft prose but not plain coverage or actual skipped-dose facts', () => {
  const preview = (summary: string) =>
    symptomSummaryTask.projectStreamedText!(
      JSON.stringify({ value: { sections: [{ summary }] } }),
      input,
    );
  expect(preview('반환 자료 용량 제한으로 제외했어요.')).toBeUndefined();
  expect(preview('복용을 건너뛴 기록이 있어요.')).toContain('건너뛴 기록');
  expect(
    preview('일부 요청한 정보는 이번 요약에 포함하지 못했어요.'),
  ).toContain('포함하지 못했어요');
});
