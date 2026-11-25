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
import {
  admitConversationA2UILocalDraftFrames,
  conversationA2UILocalDraftFor,
} from './conversationA2UILocalDraftFrames';
import { isObject } from './taskHistory';
import type { GroundedRagAnswer } from './task';
import { projectConversationA2UISkeleton } from './conversationA2UISkeleton';

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

const localDraftFrameSchema = {
  ...staticCatalogFrameSchema,
  description:
    staticCatalogFrameSchema.description +
    ' For a scratch area requested by the user only, a root Column can end in one local TextField and one reset Button. ' +
    'Use these as the last two frames: updateDataModel with path "/local/draft" and value ""; then updateComponents with ' +
    'the root Column, any ordinary definitions, then three nodes: TextField with label "이 화면에서만 쓰는 메모", variant "shortText", and value {"@path":"/local/draft"}; ' +
    'Button with action {"event":{"name":"orot:reset-local-draft","context":{}}} and child set to the third node; Text with text "메모 지우기". ' +
    'Append only the TextField and Button ids after the ordinary root children. No user information, initial values, or agent-bound actions.',
};
const alignedCatalogFrameSchema = {
  ...localDraftFrameSchema,
  description:
    localDraftFrameSchema.description +
    ' For ordinary static layouts, Row and Column also accept literal align and justify tokens from the basic catalog. Do not use alignment on a scratch area surface.',
};

/** Reduce one completed provider reply in isolation. No provisional tree escapes. */
export function acceptConversationA2UIFrameSequence(
  raw: unknown,
  answer: string,
  allowStaticCatalog = false,
  allowAlignment = false,
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
      allowAlignment,
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
  taskVersion: '21' | '22' | '23' | '24' = '21',
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion,
    projectStreamedLayout(raw, input) {
      return eligible(input) ? projectConversationA2UISkeleton(raw) : undefined;
    },
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
            taskVersion === '24'
              ? alignedCatalogFrameSchema
              : taskVersion === '23'
                ? localDraftFrameSchema
                : taskVersion === '22'
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
      const answer = validated.value.answer;
      let root = acceptConversationA2UIFrameSequence(
        a2uiFrames,
        answer,
        taskVersion !== '21',
        taskVersion === '24',
      );
      if (!root && (taskVersion === '23' || taskVersion === '24')) {
        const validateDraftBase = (frames: unknown, body: string) =>
          acceptConversationA2UIFrameSequence(frames, body, true);
        root = admitConversationA2UILocalDraftFrames(
          a2uiFrames,
          answer,
          validateDraftBase,
        );
      }
      if (!root) return validated;
      const draft = conversationA2UILocalDraftFor(root);
      const presented = {
        ...validated.value,
        a2uiPresentation: root,
        ...(draft ? { a2uiLocalDraft: draft } : {}),
      };
      return { ...validated, value: presented };
    },
  };
}

export function versionedConversationA2UITasks(
  previous: TaskResponderContract<GroundedRagAnswer>,
  eligible: (input: TaskResponderInput) => boolean,
) {
  const version = (id: '21' | '22' | '23' | '24') =>
    withConversationA2UIFrameSequence(previous, eligible, id);
  return {
    conversationTaskV21: version('21'),
    conversationTaskV22: version('22'),
    conversationTaskV23: version('23'),
    ragConversationTask: version('24'),
  };
}
