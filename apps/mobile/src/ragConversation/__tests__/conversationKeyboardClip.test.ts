import { clipConversationToKeyboard } from '../conversationKeyboardClip';

const host = { x: 20, y: 45 };
const expanded = {
  top: 5,
  height: 680,
  leading: 0,
  activityWidth: 280,
  gap: 20,
  transcriptWidth: 350,
};
const keyboard = { x: 0, y: 450, width: 670, height: 290 };

test('shortens both panes to the docked keyboard top without reserving it twice', () => {
  const clipped = clipConversationToKeyboard(expanded, host, keyboard);
  expect(clipped).toEqual({ ...expanded, height: 400 });
  expect(clipConversationToKeyboard(clipped, host, keyboard)).toBe(clipped);
  expect(clipConversationToKeyboard(expanded, host)).toBe(expanded);
});

test('keeps the compact composer above a keyboard in the same host', () => {
  const compact = { ...expanded, activityWidth: 0, gap: 0 };
  const clipped = clipConversationToKeyboard(compact, host, keyboard);
  expect(host.y + clipped.top + clipped.height).toBe(keyboard.y);
});

test('a keyboard outside the transcript lane cannot shorten the conversation', () => {
  expect(
    clipConversationToKeyboard(expanded, host, { ...keyboard, width: 320 }),
  ).toBe(expanded);
});
