import { parsePublicWebQuery } from '../publicWebQuery';

test('rejects free-form search text even when it appears public', () => {
  expect(
    parsePublicWebQuery({ query: 'public sleep guidance' }),
  ).toBeUndefined();
});

test.each(['public\u001fquery', 'public\u009fquery'])(
  'rejects C0 and C1 controls from free-form public queries',
  query => {
    expect(parsePublicWebQuery({ query })).toBeUndefined();
  },
);
