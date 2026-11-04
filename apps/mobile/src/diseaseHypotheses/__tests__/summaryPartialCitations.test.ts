import { symptomSummaryTask } from '../symptomSummaryTask';
import {
  evidence,
  hypothesis,
  reference,
  workflowOptionsFor,
} from '../taskTestSupport';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { symptomSummaryTaskForProvider } from '../partitionedSymptomSummaryTask';

const input = { request: '저장된 기록 요약', evidence };
const supported = hypothesis({
  title: '기록된 증상',
  summary: '원문에 증상 경과가 기록되어 있어요.',
  supportingEvidence: [reference.evidenceId],
  uncertainty: '조회한 기록에 한정돼요.',
});

test('retains a supported section with an explicit limitation when another cites an unknown source', () => {
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        supported,
        { ...supported, title: '다른 주장', supportingEvidence: ['unknown'] },
      ],
    } as never,
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses).toHaveLength(1);
  expect(result.value.hypotheses[0]).toMatchObject({
    summary: supported.summary,
    supportingEvidence: [reference],
  });
  expect(result.value.hypotheses[0]!.uncertainty).toContain(
    supported.uncertainty,
  );
  expect(result.value.omittedUnsupportedContent).toBe(true);
});

test('does not retain a section if any of its citations are unknown', () => {
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        { ...supported, supportingEvidence: [reference.evidenceId, 'unknown'] },
      ],
    } as never,
    input,
  );
  expect(result.status).toBe('invalid');
});

test('retains a supported section when another has malformed uncertainty notes', () => {
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        supported,
        {
          title: supported.title,
          summary: supported.summary,
          supportingEvidence: supported.supportingEvidence,
          contraryEvidence: [],
          missingData: [],
          uncertaintyNotes: 'unknown',
        },
      ],
    } as never,
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses).toHaveLength(1);
  expect(result.value.hypotheses[0]!.uncertainty).toBe(supported.uncertainty);
  expect(result.value.omittedUnsupportedContent).toBe(true);
});

test('retains the safe section through the workflow without accepting the unknown citation', async () => {
  const options = workflowOptionsFor({
    sections: [supported, { ...supported, supportingEvidence: ['unknown'] }],
  });
  const result = await runMultiAgentWorkflow({
    ...options,
    task: symptomSummaryTask,
  });
  expect(result.status).toBe('result');
  if (result.status !== 'result') return;
  expect(result.value.hypotheses).toHaveLength(1);
  expect(result.value.hypotheses[0]!.supportingEvidence).toEqual([reference]);
  expect(result.citations).toEqual([reference]);
  expect(result.value.omittedUnsupportedContent).toBe(true);
});

test('does not salvage a section containing a definitive diagnosis merely because another section has bad citations', () => {
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        { ...supported, summary: 'You definitely have diabetes.' },
        { ...supported, supportingEvidence: ['unknown'] },
      ],
    } as never,
    input,
  );
  expect(result.status).toBe('invalid');
});

test('retains a supported measurement when a separate medication claim asserts an unrecorded dose', () => {
  const med = {
    ...reference,
    evidenceId: 'med',
    sourceId: 'med',
    content:
      'medication_definition: {"displayText":"예시약","hasSchedule":true}',
  };
  const heart = {
    ...reference,
    evidenceId: 'heart',
    sourceId: 'heart',
    content:
      'health_observation: {"concept":"heart_rate","value":{"kind":"quantity","amount":72,"unit":"count/min"}}',
  };
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        {
          ...supported,
          title: '약',
          summary: '예시약을 복용했어요.',
          supportingEvidence: ['med'],
        },
        {
          ...supported,
          title: '심박수',
          summary: '심박수 72 count/min이 기록됐어요.',
          supportingEvidence: ['heart'],
        },
      ],
    } as never,
    { ...input, evidence: { ...evidence, items: [med, heart] } },
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses).toHaveLength(1);
  expect(result.value.hypotheses[0]!.summary).toContain('72');
  expect(result.value.omittedUnsupportedContent).toBe(true);
});

test('keeps full-length limitations and separately marks omitted content', () => {
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        { ...supported, uncertainty: '가'.repeat(500) },
        { ...supported, title: '두 번째 기록', uncertainty: '나'.repeat(500) },
        { ...supported, supportingEvidence: ['unknown'] },
      ],
    } as never,
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses[0]!.uncertainty).toHaveLength(500);
  expect(result.value.hypotheses[1]!.uncertainty).toHaveLength(500);
  expect(result.value.omittedUnsupportedContent).toBe(true);
});

test('retains supported facts from a grouped source when another section from that source is excluded', () => {
  const content =
    'health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"step_count","value":{"kind":"quantity","amount":1234,"unit":"count"}},{"kind":"health_observation","concept":"heart_rate","value":{"kind":"quantity","amount":76,"unit":"count/min"}}]}';
  const result = symptomSummaryTaskForProvider(
    'synthetic-cloud',
  ).validateResult(
    {
      recordSelections: [
        {
          sourceId: reference.evidenceId,
          rows: ['r1', { row: 'r0', value: '1234회' }],
          limitationCodes: ['subset_only'],
        },
      ],
    } as never,
    { ...input, evidence: { ...evidence, items: [{ ...reference, content }] } },
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses).toHaveLength(1);
  expect(result.value.hypotheses[0]!.summary).toContain('76');
  expect(result.value.hypotheses[0]!.summary).not.toContain('1234회');
  expect(result.value.hypotheses[0]!.uncertainty).toBe(supported.uncertainty);
  expect(result.value.hypotheses[0]!.supportingEvidence).toEqual([reference]);
  expect(result.value.omittedUnsupportedContent).toBe(true);
});

test('does not accept an unrelated wrong measurement when a section from the same source is omitted', () => {
  const content =
    'health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"step_count","value":{"kind":"quantity","amount":1234,"unit":"count"}},{"kind":"health_observation","concept":"heart_rate","value":{"kind":"quantity","amount":76,"unit":"count/min"}}]}';
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        { ...supported, summary: '걸음 수는 1234회 기록됐어요.' },
        {
          ...supported,
          summary: '걸음 수는 1234걸음이고 심박수는 999회/분이에요.',
        },
      ],
    } as never,
    { ...input, evidence: { ...evidence, items: [{ ...reference, content }] } },
  );
  expect(result.status).toBe('invalid');
});

test('retains a supported summary with an explicit marker when evidence is missing', async () => {
  const partialEvidence = {
    ...evidence,
    coverage: evidence.coverage.map(entry => ({
      ...entry,
      gaps: ['Some sources unavailable'],
    })),
  };
  const result = await runMultiAgentWorkflow({
    ...workflowOptionsFor({ sections: [supported] }),
    initialEvidence: partialEvidence,
    task: symptomSummaryTask,
  });
  expect(result.status).toBe('result');
  if (result.status !== 'result') return;
  expect(result.value.hypotheses[0]!.supportingEvidence).toEqual([reference]);
  expect(result.partialEvidence).toBe(true);
  expect(result.value.hypotheses[0]!.uncertainty).toBe(supported.uncertainty);
});

test('does not infer which evidence is safe from an unattributed conflict string', async () => {
  const result = await runMultiAgentWorkflow({
    ...workflowOptionsFor({ sections: [supported] }),
    initialEvidence: {
      ...evidence,
      conflicts: ['Synthetic conflicting source reports'],
    },
    task: symptomSummaryTask,
  });
  expect(result.status).toBe('needs_clarification');
});
