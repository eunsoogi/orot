import { mountConversationA2UILocalDraft } from '../conversationA2UILocalDraft';

const layout = { fieldId: 'memo', resetId: 'clear' };

test('exact field and reset control only ever edit this draft', () => {
  const draft = mountConversationA2UILocalDraft(layout, 'orot:s:m', () => true)!;
  expect(draft.read('memo')).toBe('');
  expect(draft.change('memo', '합성 메모')).toBe(true);
  expect(draft.change('clear', 'invalid')).toBe(false);
  expect(draft.reset('foreign')).toBe(false);
  expect(draft.read('memo')).toBe('합성 메모');
  expect(draft.reset('clear')).toBe(true);
  expect(draft.read('memo')).toBe('');
  expect(draft.change('memo', 'x'.repeat(257))).toBe(false);
});

test('retired callbacks cannot change a replacement', () => {
  let active = true;
  const previous = mountConversationA2UILocalDraft(
    layout,
    'orot:s:m',
    () => active,
  )!;
  expect(previous.change('memo', 'old')).toBe(true);
  active = false;
  expect(previous.reset('clear')).toBe(false);
  active = true;
  expect(previous.change('memo', 'late')).toBe(false);
  const next = mountConversationA2UILocalDraft(layout, 'orot:s:m', () => true)!;
  expect(next.change('memo', 'next')).toBe(true);
  previous.retire();
  expect(previous.reset('clear')).toBe(false);
  expect(next.read('memo')).toBe('next');
});
