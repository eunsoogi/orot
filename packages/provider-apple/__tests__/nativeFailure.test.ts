import { nativeFailure } from '../src/helpers';

test('keeps native safety refusal distinct from unsupported input and app failures', () => {
  expect(nativeFailure({ code: 'SAFETY_REFUSAL', message: 'Model declined' })).toEqual({
    code: 'safety_refusal',
    message: 'Model declined',
    retryable: false,
  });
  expect(nativeFailure({ code: 'UNSUPPORTED_INPUT' }).code).toBe('unsupported_input');
  expect(nativeFailure({ code: 'GENERATION_FAILED' }).code).toBe('internal_error');
});
