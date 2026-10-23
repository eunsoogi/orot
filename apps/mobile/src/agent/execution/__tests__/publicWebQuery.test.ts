import { parsePublicWebQuery } from '../publicWebQuery';

test('preserves free-form query text that contains no control characters', () => {
  expect(parsePublicWebQuery({ query: '  public sleep guidance  ' })).toEqual({
    query: 'public sleep guidance',
  });
});

test.each(['public\u001fquery', 'public\u009fquery'])(
  'rejects C0 and C1 controls from free-form public queries',
  query => {
    expect(parsePublicWebQuery({ query })).toBeUndefined();
  },
);
