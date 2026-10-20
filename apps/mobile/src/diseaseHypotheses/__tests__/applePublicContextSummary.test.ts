import type { TaskResponderInput } from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import { partitionedSymptomSummaryTask as task } from '../partitionedSymptomSummaryTask';
import { hypothesis, reference } from '../taskTestSupport';

const input: TaskResponderInput = {
  request: '기록과 관련된 공개 의학 정보를 한국어로 정리해 주세요.',
  resultPartition: { sourceKind: 'external_medical', index: 1, total: 2 },
  evidence: {
    items: [
      {
        ...reference,
        sourceKind: 'external_medical',
        content:
          'Synthetic study: walking and blood pressure. Observational evidence does not establish causation.',
      },
      {
        ...reference,
        evidenceId: 'e2',
        sourceId: 'public-2',
        sourceKind: 'external_medical',
        content: 'Synthetic second study for source-selection coverage.',
      },
    ],
    coverage: [],
    conflicts: [],
  },
};

test('guides a concise Korean publication section at the actual prose fields without dropping sources', () => {
  const schema = task.createResultSchema!(input);
  const sections = (schema.properties as JsonObject).sections as JsonObject;
  expect(sections.maxItems).toBe(2);
  const fields = (sections.items as JsonObject).properties as JsonObject;
  expect((fields.title as JsonObject).description).toMatch(/Korean/u);
  expect((fields.summary as JsonObject).description).toMatch(/Korean/u);
  const messages = task.createMessages(input);
  const original = messages.find(message => message.role === 'user');
  if (!original || original.role !== 'user')
    throw new Error('Missing original records');
  expect(JSON.parse(original.content as string).records[0].content).toBe(
    input.evidence.items[0]!.content,
  );
  expect(
    messages.some(
      message =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes(
          'Translate the relevant publication context into Korean',
        ),
    ),
  ).toBe(true);
});

test('still rejects untranslated limitations rather than discarding them', () => {
  const section = hypothesis({
    title: '걷기와 혈압에 관한 연구',
    summary:
      '합성 연구는 걷기와 혈압의 관련성을 관찰했지만 원인 관계를 확정하지는 않아요.',
    supportingEvidence: [reference.evidenceId],
    contraryEvidence: [],
    missingData: [],
  });
  const fields = Object.fromEntries(
    Object.entries(section).filter(([key]) => key !== 'uncertainty'),
  );
  expect(
    task.validateResult(
      {
        sections: [
          { ...fields, uncertaintyNotes: ['Causation is not established.'] },
        ],
      },
      input,
    ).status,
  ).toBe('invalid');
  expect(
    task.validateResult(
      {
        sections: [
          {
            ...fields,
            uncertaintyNotes: ['관찰 연구이므로 원인 관계는 확인되지 않아요.'],
          },
        ],
      },
      input,
    ).status,
  ).toBe('valid');
});
