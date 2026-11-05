import { createEuropePmcEvidenceSearchTool } from '../src';
import { publication, reference } from './multiAgent-external-evidence-fixtures';

test.each([
  ['an abstract', 'Participants were adults.', 'title, bibliography and abstract', false],
  ['no abstract', null, 'title and bibliography only', true],
  ['a whitespace abstract', '  ', 'title and bibliography only', true],
])(
  'reports actual access for %s without changing citation identity',
  async (_, abstract, access, missing) => {
    const tool = createEuropePmcEvidenceSearchTool({
      service: {
        search: async () => ({ status: 'available', publications: [{ ...publication, abstract }] }),
      },
      consent: { authorize: async () => 'authorized' },
    });
    const batch = await tool.search({
      operationRunId: 'access-run',
      operationKey: 'call',
      input: { query: 'sleep' },
      allowedScope: { sourceKinds: ['external_medical'] },
      resultLimit: 5,
      maxPayloadBytes: 65536,
      signal: new AbortController().signal,
    });
    if (!('items' in batch)) throw new Error('Expected evidence');
    const { content, ...identity } = batch.items[0]!;
    expect(identity).toEqual(reference);
    expect(content).toContain(`Access: ${access}`);
    expect(content).toContain('Full text: not retrieved');
    expect(content).toContain('Publication and retraction status: not checked by this adapter');
    expect(batch.coverage[0]?.gaps).toEqual(
      missing ? ['An abstract was unavailable for one or more Europe PMC results.'] : [],
    );
  },
);
