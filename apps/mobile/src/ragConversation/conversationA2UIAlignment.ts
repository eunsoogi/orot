import { fail } from './conversationA2UIWireValues';

const aligns = ['start', 'center', 'end', 'stretch'] as const;
const justifies = [
  'start',
  'center',
  'end',
  'spaceBetween',
  'spaceAround',
  'spaceEvenly',
  'stretch',
] as const;

export type ConversationA2UIAlignment = Readonly<{
  align?: (typeof aligns)[number];
  justify?: (typeof justifies)[number];
}>;

function parseEnum<T extends string>(value: unknown, accepted: readonly T[]) {
  if (value === undefined) return undefined;
  const match = accepted.find(entry => entry === value);
  if (!match) fail();
  return match;
}

/** These catalog properties are static tokens, never style objects or binding paths. */
export function conversationA2UIAlignment(
  align: unknown,
  justify: unknown,
): ConversationA2UIAlignment | undefined {
  const cross = parseEnum(align, aligns);
  const main = parseEnum(justify, justifies);
  return cross || main
    ? { ...(cross ? { align: cross } : {}), ...(main ? { justify: main } : {}) }
    : undefined;
}
