import type { TaskResponderInput } from '@orot/agent-runtime';
import { partitionedSymptomSummaryTask } from '../partitionedSymptomSummaryTask';
import { hypothesis, reference } from '../taskTestSupport';

const topics = [
  {
    topic: 'medications',
    medications: [{ name: '합성약', source: 'healthkit_registration' }],
  },
  {
    topic: 'measurements',
    quantities: [
      {
        concept: 'blood_pressure_systolic',
        unit: 'mmHg',
        meanOfRecordedDailyMeans: 121,
      },
      {
        concept: 'blood_pressure_diastolic',
        unit: 'mmHg',
        meanOfRecordedDailyMeans: 79,
      },
    ],
  },
  {
    topic: 'activity',
    quantities: [
      {
        concept: 'step_count',
        unit: 'count',
        meanRecordedDailySampleSum: 5000,
      },
    ],
  },
  {
    topic: 'sleep',
    sleep: { meanRecordedDailyMinutes: 420, recordedDays: 10 },
  },
  {
    topic: 'symptoms',
    symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
  },
];
const input: TaskResponderInput = {
  request: '모든 사용 가능한 기록 주제를 요약해 주세요.',
  resultPartition: { sourceKind: 'personal_record', index: 0, total: 2 },
  evidence: {
    items: topics.map((topic, index) => ({
      ...reference,
      evidenceId: `e${index + 1}`,
      sourceId: `source-${index + 1}`,
      content: 'health_context: ' + JSON.stringify(topic),
    })),
    coverage: [],
    conflicts: [],
  },
};
const recordSummaries = {
  e1: '합성약이 건강에 등록되어 있어요.',
  e2: '기록일 평균 수축기 혈압은 121 mmHg, 이완기 혈압은 79 mmHg예요.',
  e3: '기록일별 센서 표본 합계의 평균은 5000걸음이며 전체 일일 걸음수 합계는 아니에요.',
  e4: '관찰된 수면 구간의 기록일 평균은 420분이며 완전한 하룻밤 수면은 아니에요.',
};

test('cannot accept a medication-only result when usable activity, measurements and sleep were supplied', () => {
  const value = {
    sections: [
      hypothesis({
        summary: recordSummaries.e1,
        supportingEvidence: ['e1'],
        uncertainty: '',
        missingData: [],
      }),
    ],
  };
  expect(
    partitionedSymptomSummaryTask.validateResult(value, input).status,
  ).toBe('invalid');
});

test('requires one bounded summary per meaningful source and binds its citation locally', () => {
  const schema = partitionedSymptomSummaryTask.createResultSchema!(input);
  expect(schema).toMatchObject({
    required: ['recordSummaries'],
    properties: {
      recordSummaries: {
        required: ['e1', 'e2', 'e3', 'e4'],
        additionalProperties: false,
      },
    },
  });
  const result = partitionedSymptomSummaryTask.validateResult(
    { recordSummaries },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid')
    throw new Error('Expected validated factual topics');
  expect(result.value.hypotheses.map(section => section.summary)).toEqual(
    Object.values(recordSummaries),
  );
  expect(
    result.value.hypotheses.map(section =>
      section.supportingEvidence.map(ref => ref.evidenceId),
    ),
  ).toEqual([['e1'], ['e2'], ['e3'], ['e4']]);
});

test('rejects missing or invented source keys and still validates each supplied fact', () => {
  const missing = Object.fromEntries(
    Object.entries(recordSummaries).filter(([id]) => id !== 'e3'),
  );
  for (const value of [
    missing,
    { ...recordSummaries, invented: '없는 기록' },
    { ...recordSummaries, e2: '혈압을 확인했어요.' },
  ]) {
    expect(
      partitionedSymptomSummaryTask.validateResult(
        { recordSummaries: value },
        input,
      ).status,
    ).toBe('invalid');
  }
});

test('merges validated source-bound summaries into the ordinary analysis format', () => {
  const value = partitionedSymptomSummaryTask.finalResultPartition!.mergeValues(
    [
      { recordSummaries },
      {
        sections: [
          hypothesis({
            title: '공개 문헌',
            summary: '합성 문헌 설명',
            supportingEvidence: ['m1'],
          }),
        ],
      },
    ],
    input,
  ) as { sections: { summary: string }[] };
  expect(value.sections.map(section => section.summary)).toEqual([
    ...Object.values(recordSummaries),
    '합성 문헌 설명',
  ]);
});

test('projects the source-bound summary text without leaking source IDs or field names', () => {
  const raw = JSON.stringify({
    type: 'result',
    value: { recordSummaries },
    citations: ['e1', 'e2', 'e3', 'e4'],
  });
  expect(partitionedSymptomSummaryTask.projectStreamedText!(raw, input)).toBe(
    Object.values(recordSummaries).join('\n\n'),
  );
});

test('keeps the ordinary research input and raw-source schema instead of forcing computed-topic output', () => {
  const research = { ...input, resultPartition: undefined };
  expect(partitionedSymptomSummaryTask.createMessages(research)).toHaveLength(
    1,
  );
  expect(
    JSON.stringify(partitionedSymptomSummaryTask.createMessages(research)),
  ).not.toContain('requiredRecordFacts');
  expect(
    partitionedSymptomSummaryTask.createResultSchema!(research).required,
  ).toEqual(['sections']);
  const raw = {
    ...input,
    evidence: {
      ...input.evidence,
      items: [{ ...reference, content: 'Unstructured original' }],
    },
  };
  expect(
    partitionedSymptomSummaryTask.createResultSchema!(raw).required,
  ).toEqual(['sections']);
});

test('preserves real limitations in topic prose and refuses unsafe streamed clinical claims', () => {
  const limited = {
    ...recordSummaries,
    e4: recordSummaries.e4 + ' 기록하지 않은 날짜의 수면은 알 수 없어요.',
  };
  const result = partitionedSymptomSummaryTask.validateResult(
    { recordSummaries: limited },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid')
    throw new Error('Expected preserved source limitation');
  expect(result.value.hypotheses[3].summary).toBe(limited.e4);
  const raw = JSON.stringify({
    type: 'result',
    value: { recordSummaries: { e1: '확실히 당뇨병입니다.' } },
    citations: [],
  });
  expect(
    partitionedSymptomSummaryTask.projectStreamedText!(raw, input),
  ).toBeUndefined();
});

test('does not manufacture a required medication topic from a malformed registration without a name', () => {
  const malformed = {
    ...reference,
    evidenceId: 'empty-registration',
    content: 'health_context: {"topic":"medications","medications":[{}]}',
  };
  const schema = partitionedSymptomSummaryTask.createResultSchema!({
    ...input,
    evidence: {
      ...input.evidence,
      items: [...input.evidence.items, malformed],
    },
  });
  expect(
    (schema.properties as { recordSummaries: { required: string[] } })
      .recordSummaries.required,
  ).toEqual(['e1', 'e2', 'e3', 'e4']);
});
