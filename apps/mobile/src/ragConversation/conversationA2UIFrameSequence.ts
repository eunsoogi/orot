import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import {
  applyConversationA2UIFrame,
  conversationA2UIFrameLimit,
  type ConversationA2UINode,
  type ConversationA2UIState,
} from './conversationA2UI';
import {
  conversationA2UIFrameProse,
  draftA2UISurfaceId,
  matchesConversationA2UIProse,
} from './conversationA2UIPresentation';
import { isObject } from './taskHistory';
import type { GroundedRagAnswer } from './task';

const maxFinalFrames = 12;

const frameSequenceSchema = {
  type: 'array',
  items: { type: 'string' },
  maxItems: maxFinalFrames,
  description:
    'For an ordinary answer choose [] for plain text, or an ordered A2UI 1.0 protocol sequence of JSON message strings. ' +
    'Start with createSurface, then use updateComponents or updateDataModel when useful. deleteSurface returns to plain text. ' +
    'Use surfaceId "orot:response:draft", the bundled Basic catalog at "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json", ' +
    'and a root component with id "root". Use only Card, Column, Row, List and body Text. ' +
    'The final tree must contain every accepted answer line or paragraph exactly once in the same order. ' +
    'Use line breaks between text items; no markup, URLs, actions, tools or duplicated text.',
};
const staticCatalogFrameSchema = {
  ...frameSequenceSchema,
  description: frameSequenceSchema.description.replace(
    'Use only Card, Column, Row, List and body Text.',
    'Use only Card, Column, Row, List, Divider, Icon (only info or calendarToday), Tabs and body Text. Each Tabs title and its panel text consume matching answer lines.',
  ),
};

/** Reduce one completed provider reply in isolation. No provisional tree escapes. */
export function acceptConversationA2UIFrameSequence(
  raw: unknown,
  answer: string,
  allowStaticCatalog = false,
): ConversationA2UINode | undefined {
  if (!Array.isArray(raw) || !raw.length || raw.length > maxFinalFrames)
    return undefined;
  const content = conversationA2UIFrameProse(answer);
  if (!content) return undefined;
  let staged: ConversationA2UIState | null = null;
  let units = 0;
  for (const frame of raw) {
    if (typeof frame !== 'string' || frame.length > conversationA2UIFrameLimit)
      return undefined;
    units += frame.length;
    if (units > 2 * conversationA2UIFrameLimit) return undefined;
    const next = applyConversationA2UIFrame(
      staged,
      frame,
      draftA2UISurfaceId,
      allowStaticCatalog,
    );
    // An ignored foreign frame makes the whole submitted sequence unsuitable.
    if (!next || next === staged || next.status === 'invalid') return undefined;
    staged = next;
  }
  const root = staged?.root;
  if (!root || !matchesConversationA2UIProse(root, content, allowStaticCatalog))
    return undefined;
  return root;
}

/** The final validator remains the only publication authority, not the frame stream. */
export function withConversationA2UIFrameSequence(
  previous: TaskResponderContract<GroundedRagAnswer>,
  eligible: (input: TaskResponderInput) => boolean,
  taskVersion: '21' | '22' = '21',
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion,
    createResultSchema(input) {
      const schema = previous.createResultSchema!(input);
      if (!eligible(input) || !isObject(schema.properties)) return schema;
      const properties = { ...schema.properties };
      delete properties.a2ui;
      return {
        ...schema,
        properties: {
          ...properties,
          a2uiFrames:
            taskVersion === '22'
              ? staticCatalogFrameSchema
              : frameSequenceSchema,
        },
        required: [
          ...(Array.isArray(schema.required) ? schema.required : []),
          'a2uiFrames',
        ],
      };
    },
    validateResult(value, input) {
      if (!isObject(value) || !('a2uiFrames' in value))
        return previous.validateResult(value, input);
      const a2uiFrames = value.a2uiFrames;
      const prose: Record<string, (typeof value)[string]> = { ...value };
      delete prose.a2uiFrames;
      delete prose.a2ui;
      const validated = previous.validateResult(prose, input);
      if (
        validated.status !== 'valid' ||
        validated.value.answerKind !== 'conversation' ||
        !eligible(input)
      )
        return validated;
      const root = acceptConversationA2UIFrameSequence(
        a2uiFrames,
        validated.value.answer,
        taskVersion === '22',
      );
      return root
        ? {
            ...validated,
            value: { ...validated.value, a2uiPresentation: root },
          }
        : validated;
    },
  };
}
