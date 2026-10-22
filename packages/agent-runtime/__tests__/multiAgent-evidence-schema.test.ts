import { taskResponseSchema } from '../src/multiAgent/protocol';
import type { TaskResponderContract, TaskResponderInput } from '../src';

const input = (id: string): TaskResponderInput => ({
  request: 'Synthetic task',
  evidence: {
    items: [
      {
        sourceKind: 'personal_record',
        sourceId: 'synthetic',
        sourceRevision: '1',
        evidenceId: id,
        evidenceRevision: '1',
        effectiveTime: null,
        reviewState: 'reviewed',
        locator: {},
        content: 'Synthetic record',
      },
    ],
    coverage: [],
    conflicts: [],
  },
});

test('builds guidance from the current evidence instead of retaining a previous batch', () => {
  const contract: TaskResponderContract<string> = {
    taskType: 'synthetic',
    taskVersion: '1',
    systemPrompt: 'Synthetic task',
    resultSchema: { type: 'string' },
    createMessages: () => [{ role: 'user', content: 'Synthetic task' }],
    createResultSchema: (current) => ({
      type: 'string',
      enum: current.evidence.items.map((item) => item.evidenceId),
    }),
    validateResult: () => ({ status: 'invalid', reason: 'Synthetic' }),
  };
  const schema = (id: string) => JSON.stringify(taskResponseSchema(contract, input(id), true));
  expect(schema('current-e1')).toContain('"enum":["current-e1"]');
  expect(schema('current-e2')).toContain('"enum":["current-e2"]');
  expect(schema('current-e2')).not.toContain('current-e1');
  expect(JSON.stringify(taskResponseSchema(contract))).not.toContain('"enum":["current-');
});
