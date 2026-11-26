import type { JsonValue } from '@orot/model-runtime';
import type { TaskResponderContract } from '@orot/agent-runtime';
import { conversationA2UIFrameLimit } from './conversationA2UI';
import { acceptConversationA2UIFrameSequence } from './conversationA2UIFrameSequence';
import {
  allowsOrdinaryA2UI,
  conversationA2UIFrameProse,
} from './conversationA2UIPresentation';
import { projectConversationA2UISkeleton } from './conversationA2UISkeleton';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

const promptFrameItems = (includeVersion: boolean) => ({
  anyOf: [
    ...[
      'createSurface',
      'updateComponents',
      'updateDataModel',
      'deleteSurface',
    ].map(command => ({
      type: 'object',
      required: includeVersion ? ['version', command] : [command],
      additionalProperties: false,
      properties: {
        ...(includeVersion
          ? { version: { type: 'string', enum: ['1.0'] } }
          : {}),
        [command]: { type: 'object' },
      },
    })),
    { type: 'string' },
  ],
});

// Text-only model transport can emit the published frame as an object rather
// than double-escaping it. Normalization does not interpret any A2UI operation.
function normalizeObjectFrames(value: JsonValue): JsonValue {
  if (!isObject(value)) return value;
  const frames = value.a2uiFrames;
  if (!Array.isArray(frames) || frames.length > 12 || !frames.some(isObject))
    return value;
  const encoded: string[] = [];
  let units = 0;
  for (const frame of frames) {
    if (typeof frame !== 'string' && !isObject(frame)) return value;
    const wire = typeof frame === 'string' ? frame : JSON.stringify(frame);
    units += wire.length;
    if (
      wire.length > conversationA2UIFrameLimit ||
      units > 2 * conversationA2UIFrameLimit
    )
      return value;
    encoded.push(wire);
  }
  return { ...value, a2uiFrames: encoded };
}

/** New terminal geometry may not change the accepted answer or any other
 * surface. Previously supported contracts and action permissions stay intact. */
export function withConversationA2UIReplacement(
  previous: TaskResponderContract<GroundedRagAnswer>,
  version: '49' | '50' | '51' = '49',
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: version,
    projectStreamedLayout(raw, input) {
      return allowsOrdinaryA2UI(input)
        ? projectConversationA2UISkeleton(raw, true, true, version === '51')
        : undefined;
    },
    createResultSchema(input, jsonPrompt) {
      const schema =
        previous.createResultSchema?.(input) ?? previous.resultSchema;
      if (!allowsOrdinaryA2UI(input) || !isObject(schema.properties))
        return schema;
      const frames = schema.properties.a2uiFrames;
      if (!isObject(frames) || typeof frames.description !== 'string')
        return schema;
      const useObjectFrames = version !== '49' && jsonPrompt;
      const includeVersion = version === '51';
      const description = useObjectFrames
        ? frames.description.replace(
            'Use an ordered array of JSON message strings',
            'Use an ordered array of A2UI message objects (do not quote or double-encode them); JSON message strings also work. Start with the published frame object such as {' +
              (includeVersion ? '"version":"1.0",' : '') +
              '"createSurface":{"surfaceId":"orot:response:draft","catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json","components":[{"id":"root","component":"Text","text":"Your accepted answer"}]}}. Use that ordered array',
          )
        : frames.description;
      return {
        ...schema,
        properties: {
          ...schema.properties,
          a2uiFrames: {
            ...frames,
            ...(useObjectFrames
              ? { items: promptFrameItems(includeVersion) }
              : {}),
            description:
              description +
              ' One atomic updateComponents may change a ready layout, such as replacing a Card and its Column wrapper with a Row of the same exact Text leaves. Detached structural wrappers must be unchanged, already owned by this surface, and never reused; no text, title, or controls may be detached. Keep every accepted answer line in reading order.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (version !== '49' && allowsOrdinaryA2UI(input))
        value = normalizeObjectFrames(value);
      const accepted = previous.validateResult(value, input);
      if (
        accepted.status !== 'valid' ||
        accepted.value.answerKind !== 'conversation' ||
        accepted.value.a2uiPresentation ||
        !allowsOrdinaryA2UI(input) ||
        !isObject(value)
      )
        return accepted;
      const root = acceptConversationA2UIFrameSequence(
        value.a2uiFrames,
        accepted.value.answer,
        true,
        true,
        true,
        'vertical_align',
        conversationA2UIFrameProse,
        true,
      );
      return root
        ? { ...accepted, value: { ...accepted.value, a2uiPresentation: root } }
        : accepted;
    },
  };
}
