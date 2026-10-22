import { queryInput } from '../evidenceSearchQuery';

test('accepts only an explicit model-selected overview view while preserving ordinary queries', () => {
  expect(
    queryInput({ query: 'health', view: 'health_overview' }, false),
  ).toBeUndefined();
  expect(
    queryInput({ query: ' health records ', view: 'health_overview' }),
  ).toEqual({ query: 'health records', view: 'health_overview' });
  expect(queryInput({ query: 'heart rate' })).toEqual({ query: 'heart rate' });
  expect(
    queryInput({ query: 'heart rate', view: 'unbounded' }),
  ).toBeUndefined();
  expect(
    queryInput({ query: 'heart rate', view: 'health_overview', extra: true }),
  ).toBeUndefined();
});
