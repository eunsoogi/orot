import { serializeAppleRequest } from '../serializeRequest';

test('uses the same compact receipt for the native callback and prompt without duplicating current facts', () => {
  const call = {
    id: 'held-call',
    name: 'read_records',
    arguments: { query: 'synthetic' },
  };
  const receipt = {
    contentLocation: 'current_task_messages',
    evidenceIds: ['evidence-1'],
    coverage: [{ sourceKind: 'personal_record', returnedCount: 1 }],
    conflicts: [],
  };
  const native = serializeAppleRequest({
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          records: [
            { evidenceId: 'evidence-1', content: 'Synthetic complete fact.' },
          ],
        }),
      },
      { role: 'assistant', content: '', toolCalls: [call] },
      { role: 'tool', toolCallId: call.id, result: receipt },
    ],
  });
  expect(native.nativeToolCalls).toEqual([call]);
  expect(native.nativeToolResults).toEqual([
    { toolCallId: call.id, result: receipt },
  ]);
  expect(native.prompt).toContain(
    'Tool result held-call: ' + JSON.stringify(receipt),
  );
  expect(native.prompt.split('Synthetic complete fact.')).toHaveLength(2);
});
