import { utf8ByteLength } from '../../../aiFeatures/integration/evidenceUtils';
import { runVisitQuestionWorkflow } from '../workflow';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';

// Two bounded synthetic searches must not replay their full content beside the current evidence.
test('keeps two-search visit evidence once in the final provider request', async () => {
  const fixture = preparedContext();
  const firstContent = `첫 합성 검사 기록. ${'합성 검사 관찰 내용. '.repeat(600)}`;
  const secondContent = `다음 합성 검사 기록. ${'합성 검사 관찰 내용. '.repeat(600)}`;
  const first = { ...fixture.initialEvidence, content: firstContent };
  const second = { ...fixture.supplementalEvidence, content: secondContent };
  const supplemental = await fixture.searchEvidence(
    'synthetic',
    1,
    'personal_record',
  );
  const firstBatch = {
    ...fixture.evidence,
    batch: { ...fixture.evidence.batch, items: [first] },
  };
  const secondBatch = {
    ...supplemental,
    batch: { ...supplemental.batch, items: [second] },
  };
  const prepared = {
    ...fixture,
    evidence: {
      ...fixture.evidence,
      batch: { ...fixture.evidence.batch, items: [], coverage: [] },
    },
    searchEvidence: jest
      .fn()
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch),
  };
  const [search, answer] = successfulOutputs(first, second);
  const nextSearch = JSON.parse(search!);
  nextSearch.toolCalls[0].id = 'second-synthetic-search';
  const { provider, requests } = makeProvider([
    search!,
    JSON.stringify(nextSearch),
    answer!,
  ]);
  const { selection, option } = selectedOption(provider);
  const consent = jest.fn(async () => true);
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [option],
    recipient: 'Synthetic account',
    confirmConsent: consent,
  });
  expect(result.status).toBe('ready');
  expect(requests).toHaveLength(3);
  expect(prepared.searchEvidence).toHaveBeenCalledTimes(2);
  expect(consent).toHaveBeenCalledTimes(3);
  const final = requests[2]!;
  const serialized = JSON.stringify(final);
  expect(utf8ByteLength(serialized)).toBeLessThanOrEqual(64 * 1024);
  expect(serialized.split(firstContent)).toHaveLength(2);
  expect(serialized.split(secondContent)).toHaveLength(2);
  const tools = final.messages.filter(message => message.role === 'tool');
  expect(tools).toHaveLength(2);
  expect(tools.map(message => message.result)).toEqual([
    expect.objectContaining({
      contentLocation: 'current_task_messages',
      evidenceIds: ['evidence-1'],
    }),
    expect.objectContaining({
      contentLocation: 'current_task_messages',
      evidenceIds: ['evidence-2'],
    }),
  ]);
  expect(JSON.stringify(tools)).not.toContain(firstContent);
  expect(JSON.stringify(tools)).not.toContain(secondContent);
  if (result.status === 'ready')
    expect(result.questions[0]?.citations[0]?.sourceId).toBe(second.sourceId);
});
