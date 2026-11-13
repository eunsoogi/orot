import { normalizeAssistantName, parseAppearance } from '../appearance';

test('requires a known explicit avatar and accepts legacy names', () => {
  expect(parseAppearance('{"avatar":"neutral"}')).toEqual({
    avatar: 'neutral',
    name: null,
  });
  expect(parseAppearance('{"avatar":"unknown"}')).toBeNull();
  expect(parseAppearance('{}')).toBeNull();
});

test('trims optional names and validates Unicode without truncation', () => {
  expect(normalizeAssistantName('  한글  ')).toBe('한글');
  expect(normalizeAssistantName('   ')).toBeNull();
  expect(normalizeAssistantName('👩‍👩‍👧‍👦'.repeat(24))).toBe('👩‍👩‍👧‍👦'.repeat(24));
  expect(() => normalizeAssistantName('한'.repeat(25))).toThrow('length');
  expect(() => normalizeAssistantName('한\n글')).toThrow('characters');
});
