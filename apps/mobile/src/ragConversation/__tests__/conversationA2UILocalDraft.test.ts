import { mountConversationA2UILocalDraft } from '../conversationA2UILocalDraft';

const layout = { fieldId: 'memo', resetId: 'clear' };
const mount = (current: () => boolean) =>
  mountConversationA2UILocalDraft(layout, 'orot:s:m', current)!;

test('exact field and reset control only ever edit this draft', () => {
  const draft = mount(() => true);
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
  const previous = mount(() => active);
  expect(previous.change('memo', 'old')).toBe(true);
  active = false;
  expect(previous.reset('clear')).toBe(false);
  active = true;
  expect(previous.change('memo', 'late')).toBe(false);
  const next = mount(() => true);
  expect(next.change('memo', 'next')).toBe(true);
  previous.retire();
  expect(previous.reset('clear')).toBe(false);
  expect(next.read('memo')).toBe('next');
});
