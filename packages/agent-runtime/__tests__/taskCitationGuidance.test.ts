import { taskResponseSchema } from '../src/multiAgent/protocol';
import type { TaskResponderContract } from '../src';

const task: TaskResponderContract = {
  taskType: 'sample',
  taskVersion: '1',
  systemPrompt: 'Synthetic',
  resultSchema: { type: 'string' },
  createMessages: () => [],
  validateResult: (value) => ({ status: 'valid', value }),
  constrainCitationIds: true,
} as TaskResponderContract;
const input = {
  request: 'Synthetic',
  evidence: {
    items: [
      {
        sourceKind: 'personal_record' as const,
        sourceId: 's',
        sourceRevision: '1',
        evidenceId: 'current',
        evidenceRevision: '1',
        reviewState: 'reviewed' as const,
        effectiveTime: null,
        locator: { kind: 'structured_record' as const, recordId: 's' },
        content: 'Synthetic',
      },
    ],
    coverage: [],
    conflicts: [],
  },
};

test('opt-in citations use current ID choices without forcing exhaustive length', () => {
  const schema = JSON.parse(JSON.stringify(taskResponseSchema(task, input, true)));
  expect(schema.properties.citations.items.enum).toEqual(['current']);
  expect(schema.properties.citations.minItems).toBeUndefined();
  expect(schema.properties.citations.maxItems).toBeUndefined();
});

test('ordinary tasks retain non-enumerating citation guidance', () => {
  const schema = JSON.parse(
    JSON.stringify(taskResponseSchema({ ...task, constrainCitationIds: false }, input, true)),
  );
  expect(schema.properties.citations.items.enum).toBeUndefined();
});
