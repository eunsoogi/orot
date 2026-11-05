import { createEuropePmcEvidenceSearchTool } from '@orot/agent-runtime';
import { ragConversationTask } from '../task';

test('keeps each publication access limit with its own evidence in the model input', async () => {
  const base = {
    provider: 'Europe PMC' as const,
    source: 'MED',
    authors: null,
    journal: null,
    publicationDate: null,
    updatedDate: null,
    retrievedAt: '2026-10-08T00:00:00.000Z',
  };
  const tool = createEuropePmcEvidenceSearchTool({
    service: {
      search: async () => ({
        status: 'available',
        publications: [
          {
            ...base,
            recordId: '1',
            title: 'Metadata study',
            abstract: null,
            originalUrl: 'https://europepmc.org/article/MED/1',
          },
          {
            ...base,
            recordId: '2',
            title: 'Adult study',
            abstract: 'Participants were adults.',
            originalUrl: 'https://europepmc.org/article/MED/2',
          },
        ],
      }),
    },
    consent: { authorize: async () => 'authorized' },
  });
  const evidence = await tool.search({
    operationRunId: 'input-run',
    operationKey: 'call',
    input: { query: 'sleep' },
    allowedScope: { sourceKinds: ['external_medical'] },
    resultLimit: 5,
    maxPayloadBytes: 65536,
    signal: new AbortController().signal,
  });
  if (!('items' in evidence)) throw new Error('Expected evidence');
  const message = ragConversationTask.createMessages({
    request: 'Explain the studies',
    evidence,
  })[0];
  if (message.role !== 'user' || typeof message.content !== 'string')
    throw new Error('Expected model input');
  const items = JSON.parse(message.content).evidence;
  expect(items[0].content).toContain('Access: title and bibliography only');
  expect(items[0].content).not.toContain('Participants were adults.');
  expect(items[1].content).toContain(
    'Access: title, bibliography and abstract',
  );
  expect(items[1].content).toContain('Participants were adults.');
  expect(
    items.every((item: { content: string }) =>
      item.content.includes('Full text: not retrieved'),
    ),
  ).toBe(true);
  expect(ragConversationTask.systemPrompt).toContain(
    'only when its actual abstract supplies them',
  );
  expect(ragConversationTask.systemPrompt).toContain(
    'Historical publication metadata cannot substitute for a fresh abstract',
  );
  expect(ragConversationTask.systemPrompt).toContain(
    'Never infer that full text was read',
  );
});
