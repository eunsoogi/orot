import { decodeTaskResponse } from '../src/multiAgent/taskResponseDecoding';

const property = 'a2uiFrames';

const result = (value: unknown) => ({ type: 'result', citations: [], value });

test.each([
  { value: { answer: 'private' }, expected: 'absent' },
  { value: { nested: { a2uiFrames: ['private'] } }, expected: 'absent' },
  { value: { a2uiFrames: [] }, expected: 'present' },
  { value: { a2uiFrames: null }, expected: 'present' },
])('observes only direct field presence: $expected', async ({ value, expected }) => {
  const report = jest.fn();
  const envelope = result(value);
  const decoded = await decodeTaskResponse(
    { text: JSON.stringify(envelope) },
    { property, report },
  );

  expect(decoded.output).toEqual(envelope);
  expect(report.mock.calls).toEqual([[expected]]);
});

test('failed text envelope and native structured-output path are distinct', async () => {
  const report = jest.fn();
  await expect(
    decodeTaskResponse({ text: 'content is not JSON' }, { property, report }),
  ).resolves.toHaveProperty('reason');
  expect(report.mock.calls).toEqual([['decode_failed']]);

  const structuredOutput = result({ a2uiFrames: [] });
  await expect(
    decodeTaskResponse({ text: '', structuredOutput }, { property, report }),
  ).resolves.toEqual({ output: structuredOutput });
  expect(report.mock.calls).toEqual([['decode_failed']]);
});

test('a failing observer cannot alter the accepted result bytes', async () => {
  const envelope = result({ a2uiFrames: ['private'] });
  const report = () => {
    throw new Error('synthetic observer failure');
  };
  await expect(
    decodeTaskResponse({ text: JSON.stringify(envelope) }, { property, report }),
  ).resolves.toEqual({ output: envelope });
});
