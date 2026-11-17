import { priorMessages } from '../taskHistory';

// #1350: transport validation must not silently truncate retained conversation.
test('preserves every complete valid message while rejecting malformed context', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? ('assistant' as const) : ('user' as const),
    content: `${index} ${'한😀'.repeat(1100)}`,
  }));
  const mixed = [
    null,
    { role: 'system', content: 'not a conversation message' },
    { role: 'user', content: 1 },
    ['not an object'],
    ...history,
  ];
  expect(priorMessages(mixed)).toEqual(history);
  expect(priorMessages({ history: mixed })).toEqual(history);
  expect(priorMessages(undefined)).toEqual([]);
  expect(priorMessages({ history: 'invalid' })).toEqual([]);
});
