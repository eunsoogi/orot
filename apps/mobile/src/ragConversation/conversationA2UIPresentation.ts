import {
  applyConversationA2UIFrame,
  conversationA2UIFrameLimit,
  type ConversationA2UINode,
} from './conversationA2UI';

/** This fixed draft stamp gives a model no ingress route to a real session. */
const draftId = 'orot:response:draft';

export const conversationA2UIPresentationSchema = {
  type: 'string',
  description:
    'Optional, for ordinary conversation only: one A2UI 1.0 createSurface JSON message encoded as a string. ' +
    'Use surfaceId "orot:response:draft", catalogId "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json" and inline components with id "root". ' +
    'Use only Card, Column, List, Row and body Text; each Text must be an unchanged nonempty paragraph of answer, in the same order. ' +
    'Separate answer paragraphs with exactly two newlines. No bindings to anything except inline string data, and no actions, links, markup, or other content. Omit if plain text is clearer.',
};

/** Layout may neither add, remove, reorder, repeat nor demote any accepted prose. */
export function admitConversationA2UIPresentation(
  raw: unknown,
  answer: string,
): ConversationA2UINode | undefined {
  if (
    typeof raw !== 'string' ||
    raw.length > conversationA2UIFrameLimit ||
    !answer ||
    /[\r<>#*`_~[\]]|\b(?:https?:|www\.)|(?:^|\n)(?:[ \t]|[-+>] |\d+[.)] )/u.test(
      answer,
    )
  )
    return undefined;
  const state = applyConversationA2UIFrame(null, raw, draftId);
  if (state?.status !== 'ready' || !state.root) return undefined;
  const paragraphs = answer.split('\n\n');
  if (
    paragraphs.some(
      paragraph =>
        !paragraph ||
        paragraph.includes('\n') ||
        paragraph.trim() !== paragraph,
    )
  )
    return undefined;
  let position = 0;
  function matches(node: ConversationA2UINode): boolean {
    if (node.component === 'Text')
      return node.variant === 'body' && node.text === paragraphs[position++];
    return node.children.every(matches);
  }
  return matches(state.root) && position === paragraphs.length
    ? state.root
    : undefined;
}
