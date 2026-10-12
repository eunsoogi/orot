import { citationReferences } from '../src/multiAgent/protocol';
import { guidedSchema } from '../src/multiAgent/guidedSchema';
import type { EvidenceBatch, EvidenceItem } from '../src';
import { buildTaskRequest } from '../src/multiAgent/requests';
import { DEFAULT_MULTI_AGENT_BUDGET } from '../src';

const item: EvidenceItem = {
  sourceKind: 'personal_record',
  sourceId: 'source-1',
  sourceRevision: 'revision-1',
  evidenceId: 'evidence-1',
  evidenceRevision: 'revision-1',
  locator: { kind: 'structured_record', recordId: 'record-1' },
  effectiveTime: null,
  reviewState: 'reviewed',
  content: 'Synthetic evidence',
};
const batch: EvidenceBatch = { items: [item], coverage: [], conflicts: [] };

test('binds generated citation IDs to exact current references, rejecting unknown or ambiguous IDs', () => {
  expect(citationReferences(['evidence-1'], batch)).toEqual([
    expect.objectContaining({ sourceId: 'source-1', evidenceRevision: 'revision-1' }),
  ]);
  expect(citationReferences(['missing'], batch)).toBeUndefined();
  expect(citationReferences(['evidence-1', 'evidence-1'], batch)).toBeUndefined();
  expect(
    citationReferences(['evidence-1'], {
      ...batch,
      items: [item, { ...item, sourceId: 'other-source' }],
    }),
  ).toBeUndefined();
});

test('projects native generation guidance without mutating the authoritative schema', () => {
  const original = {
    oneOf: [
      {
        type: 'object',
        properties: {
          status: { const: 'ready' },
          text: { type: 'string', minLength: 2, maxLength: 5 },
        },
      },
    ],
  };
  const before = JSON.stringify(original);
  expect(guidedSchema(original)).toEqual({
    anyOf: [
      { type: 'object', properties: { status: { enum: ['ready'] }, text: { type: 'string' } } },
    ],
  });
  expect(JSON.stringify(original)).toBe(before);
  expect(guidedSchema({ type: 'string', unsupportedKeyword: true })).toEqual({
    type: 'string',
    unsupportedKeyword: true,
  });
});

test('guided citation appendix sends only allowlisted IDs and leaves reference validation local', () => {
  const request = buildTaskRequest(
    {
      kind: 'language-model',
      id: 'guided',
      displayName: 'Guided',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: true,
        toolCalling: false,
      },
      generate: async () => {
        throw new Error('Not used');
      },
    },
    {
      taskType: 'test',
      taskVersion: '1',
      systemPrompt: 'Use current evidence.',
      resultSchema: { type: 'string' },
      createMessages: () => [{ role: 'user', content: 'Synthetic task' }],
      validateResult: (value) => ({ status: 'valid', value }),
    },
    { request: 'Synthetic task', evidence: batch },
    DEFAULT_MULTI_AGENT_BUDGET,
  );
  if (request.status !== 'ready') throw new Error('Expected request');
  const appendix = request.request.messages.at(-1);
  if (appendix?.role !== 'user' || typeof appendix.content !== 'string')
    throw new Error('Expected appendix');
  expect(JSON.parse(appendix.content.split('\n')[1]!)).toEqual(['evidence-1']);
  expect(appendix.content).not.toContain('sourceRevision');
  expect(JSON.stringify(request.request.responseFormat?.schema)).toContain('exact unique union');
  expect(citationReferences(['evidence-1'], batch)?.[0]?.sourceRevision).toBe('revision-1');
});
