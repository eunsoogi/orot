import { serializeAppleRequest } from '../serializeRequest';
import { createHealthContextTool } from '../../../aiFeatures/integration/healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../../../aiFeatures/integration/evidenceRegistry';

test('serializes the actual longitudinal tool before selection on Apple native tool calling', () => {
  const read = jest.fn(async () => {
    throw new Error('No preloading');
  });
  const tool = createHealthContextTool(
    read,
    new LocalEvidenceReferenceRegistry(),
  );
  const native = serializeAppleRequest({
    messages: [{ role: 'user', content: 'Synthetic summary request' }],
    tools: [
      {
        name: tool.id,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
    ],
    toolChoice: 'required',
  });
  expect(native.nativeTools).toHaveLength(1);
  expect(native.nativeTools![0]?.parameters).toMatchObject({
    kind: 'object',
    properties: expect.arrayContaining([
      expect.objectContaining({
        name: 'days',
        schema: expect.objectContaining({ kind: 'integer' }),
        optional: true,
      }),
    ]),
  });
  expect(read).not.toHaveBeenCalled();
  expect(tool.parseInput({ days: 365 })).toBeUndefined();
  expect(tool.parseInput({ days: 30 })).toMatchObject({ days: 30 });
});
