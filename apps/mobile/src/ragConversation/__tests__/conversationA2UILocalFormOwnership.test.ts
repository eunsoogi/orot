import { mountConversationA2UILocalDraft } from '../conversationA2UILocalDraft';

test('a replaced owner rejects both captured native field writers', () => {
  const plan = {
    kind: 'paired' as const,
    fieldId: 'confirm',
    choiceId: 'choose',
  };
  let current = true;
  const old = mountConversationA2UILocalDraft(plan, 'orot:1:2', () => current);
  if (!old) throw new Error('Expected active owner.');
  expect(old.change('confirm', true)).toBe(true);
  expect(old.change('choose', 'second')).toBe(true);
  current = false;
  const next = mountConversationA2UILocalDraft(plan, 'orot:1:3', () => true);
  expect(old.change('confirm', true)).toBe(false);
  expect(old.change('choose', 'first')).toBe(false);
  expect(next?.read('confirm')).toBe(false);
  expect(next?.read('choose')).toBe('');
});
