import { parseAssistantMarkdown } from '../conversationMarkdown';

test('keeps unknown and oversized input in the unchanged prose path', () => {
  expect(parseAssistantMarkdown('Text foo_bar_baz')).toBeUndefined();
  expect(
    parseAssistantMarkdown('[Private](https://a:b@example.org)'),
  ).toBeUndefined();
  expect(parseAssistantMarkdown('[Other](orot://saved)')).toBeUndefined();
  expect(parseAssistantMarkdown('<b>literal</b>')).toBeUndefined();
  expect(parseAssistantMarkdown('**bold**'.repeat(3000))).toBeUndefined();
  expect(parseAssistantMarkdown('- a\n'.repeat(81))).toBeUndefined();
});

test('does not turn fenced or unfinished code into link actions', () => {
  const inside = '[Text](https://example.org)';
  const fence = '```';
  expect(parseAssistantMarkdown([fence, inside, fence].join('\n'))).toEqual([
    { kind: 'code', text: inside },
  ]);
  expect(parseAssistantMarkdown([fence, inside].join('\n'))).toBeUndefined();
  expect(
    parseAssistantMarkdown(['## Title', fence, inside].join('\n')),
  ).toEqual([
    { kind: 'heading', runs: [{ kind: 'text', text: 'Title' }] },
    { kind: 'code', text: [fence, inside].join('\n') },
  ]);
});

test('admits valid inline-only links but never converts remote images', () => {
  expect(parseAssistantMarkdown('[Ref](https://example.org)')).toEqual([
    {
      kind: 'paragraph',
      runs: [{ kind: 'link', text: 'Ref', url: 'https://example.org' }],
    },
  ]);
  expect(
    parseAssistantMarkdown('![Photo](https://example.org/x.png)'),
  ).toBeUndefined();
});

test('plain multiline text retains its existing text path', () => {
  expect(
    parseAssistantMarkdown('Original first paragraph.\n\nNext paragraph.'),
  ).toBeUndefined();
});
