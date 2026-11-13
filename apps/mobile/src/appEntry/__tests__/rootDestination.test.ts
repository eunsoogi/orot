import { decodeRootURL, rootDestinationTab } from '../rootDestination';

test.each([
  ['conversation', 'conversation'],
  ['overview', 'overview'],
  ['records', 'records'],
  ['schedule', 'schedule'],
  ['settings', 'settings'],
] as const)('decodes only the explicit %s root', (destination, tab) => {
  expect(decodeRootURL(`orot://open/v1/${destination}`)).toBe(destination);
  expect(rootDestinationTab(destination)).toBe(tab);
});

test.each([
  ['home', 'overview'],
  ['ai', 'conversation'],
] as const)('normalizes legacy %s links to %s', (legacy, canonical) => {
  expect(decodeRootURL(`orot://open/v1/${legacy}`)).toBe(canonical);
});

test.each([
  'orot://user@open/v1/records',
  'orot://open:44/v1/records',
  'orot://open/v1/records?x=1',
  'orot://open/v1/records#x',
  'orot://open/v1/records/other',
  'orot://open/v1/%72ecords',
  'orot://open/v1/%ZZ',
  'https://open/v1/records',
  'orot://open/v1/records\n',
])('rejects unsupported input without a fallback: %s', value => {
  expect(decodeRootURL(value)).toBeNull();
});
