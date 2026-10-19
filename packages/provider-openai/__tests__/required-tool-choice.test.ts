import { prepareRequest } from '../src/request-mapper';
import { requestWithTools } from './tool-calling.test-support';

test('preserves required tool selection through the native request boundary', () => {
  const result = prepareRequest('synthetic', { ...requestWithTools, toolChoice: 'required' });
  expect(result).toMatchObject({ ok: true, value: { toolChoice: 'required' } });
});
