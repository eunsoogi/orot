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
  e1: { m0: 'status' },
  e2: { q0: 'mean', q1: 'mean' },
  e3: { q0: 'mean' },
  e4: { sleep: 'mean' },
};

function boundSummaries() {
  const result = partitionedSymptomSummaryTask.validateResult(
    { recordSummaries },
    input,
  );
  if (result.status !== 'valid')
    throw new Error('Expected source-bound summaries');
  return result.value.hypotheses.map(section => section.summary);
}

test('cannot accept a medication-only result when usable activity, measurements and sleep were supplied', () => {
  const value = {
    sections: [
      hypothesis({
        summary: '합성약이 건강에 등록되어 있어요.',
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

test('requests compact complete topic summaries while retaining every original record', () => {
  const messages = partitionedSymptomSummaryTask
    .createMessages(input)
    .flatMap(message =>
      message.role === 'user' ? [JSON.parse(message.content as string)] : [],
    );
  const records = messages[0].records;
  expect(records.map((record: { content: string }) => record.content)).toEqual(
    input.evidence.items.map(item => item.content),
  );
  const guidance = messages[1];
  expect(guidance.outputPlan.format).toBe('source_bound_statistic_selections');
  expect(messages).toHaveLength(2);
  expect(guidance.requiredRecordFacts).toBeUndefined();
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
  expect(result.value.hypotheses.map(section => section.summary)).toEqual([
    expect.stringContaining('합성약'),
    expect.stringContaining('121 mmHg'),
    expect.stringContaining('5000 걸음'),
    expect.stringContaining('420분'),
  ]);
  expect(result.value.hypotheses[1].summary).toContain('79 mmHg');
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
    ...boundSummaries(),
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
    boundSummaries().join('\n\n'),
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

test('preserves source-derived limitations and refuses unsafe model-written clinical claims', () => {
  const result = partitionedSymptomSummaryTask.validateResult(
    { recordSummaries },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid')
    throw new Error('Expected preserved source limitation');
  expect(result.value.hypotheses[3].summary).toContain(
    '기록하지 않은 날짜의 수면은 알 수 없어요.',
  );
  expect(result.value.hypotheses[2].summary).toContain(
    '중복될 수 있어 합산하거나 전체 일일 걸음수로 해석할 수 없어요.',
  );
  const raw = JSON.stringify({
    type: 'result',
    value: { recordSummaries: { e1: '확실히 당뇨병입니다.' } },
    citations: [],
  });
  expect(
    partitionedSymptomSummaryTask.projectStreamedText!(raw, input),
  ).toBeUndefined();
});
