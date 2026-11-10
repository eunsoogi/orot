import { toProviderError } from '../src/errors';

test('preserves only the explicit offline native category', () => {
  expect(toProviderError({ kind: 'offline' })).toMatchObject({
    code: 'provider_unavailable',
    connectivity: 'offline',
  });
  for (const error of [
    { kind: 'transport' },
    { kind: 'transport', code: 'notConnectedToInternet' },
    { httpStatusCode: 503 },
    { kind: 'interrupted' },
    new Error('offline'),
  ]) {
    expect(toProviderError(error).connectivity).toBeUndefined();
  }
});
