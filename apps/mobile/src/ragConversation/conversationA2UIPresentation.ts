import {
  applyConversationA2UIFrame,
  conversationA2UIFrameLimit,
  conversationA2UICatalog,
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
  if (typeof raw !== 'string' || raw.length > conversationA2UIFrameLimit)
    return undefined;
  const paragraphs = conversationA2UIProse(answer);
  if (!paragraphs) return undefined;
  return admitExactParagraphs(raw, paragraphs);
}

function admitExactParagraphs(raw: string, paragraphs: readonly string[]) {
  const state = applyConversationA2UIFrame(null, raw, draftId);
  if (state?.status !== 'ready' || !state.root) return undefined;
  const expected = paragraphs;
  let position = 0;
  function matches(node: ConversationA2UINode): boolean {
    if (node.component === 'Text')
      return node.variant === 'body' && node.text === expected[position++];
    return node.children.every(matches);
  }
  return matches(state.root) && position === paragraphs.length
    ? state.root
    : undefined;
}

/** Only whole unchanged plain paragraphs can own a read-only surface. */
export function conversationA2UIProse(answer: string) {
  if (
    !answer ||
    /[\r<>#*`_~[\]]|\b(?:https?:|www\.)|(?:^|\n)(?:[ \t]|[-+>] |\d+[.)] )/u.test(
      answer,
    )
  )
    return undefined;
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
  return paragraphs;
}

/** A small, explicit provider choice. List content comes only from the accepted answer. */
export const answerLayoutSchema = {
  type: 'string',
  enum: ['plain', 'list'],
  description:
    'For completed ordinary replies, choose list when multiple distinct items are clearer as a list; otherwise choose plain. ' +
    'For list, write one item per line or paragraph, without markup, manual bullets, numbering, a list heading, or duplicated prose. ' +
    'Keep needed context and qualifications; use plain if items cannot stand alone.',
};

export function admitModelChosenConversationList(
  layout: unknown,
  answer: string,
): ConversationA2UINode | undefined {
  if (layout !== 'list' || answer.length > 8_192) return undefined;
  const paragraphs = answer.split(/\n\n?/u);
  if (
    paragraphs.length < 2 ||
    paragraphs.length > 12 ||
    paragraphs.some(paragraph => !conversationA2UIProse(paragraph))
  )
    return undefined;
  const text = paragraphs.map((paragraph, index) => ({
    id: `item${index}`,
    component: 'Text',
    text: paragraph,
  }));
  return admitExactParagraphs(
    JSON.stringify({
      version: '1.0',
      createSurface: {
        surfaceId: draftId,
        catalogId: conversationA2UICatalog,
        components: [
          { id: 'root', component: 'Card', child: 'items' },
          {
            id: 'items',
            component: 'List',
            children: text.map(item => item.id),
          },
          ...text,
        ],
      },
    }),
    paragraphs,
  );
}
