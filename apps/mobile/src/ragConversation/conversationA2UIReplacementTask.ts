import {
  bindConversationA2UIComposedReset,
  projectConversationA2UIComposedReset,
} from './conversationA2UIComposedReset';
import { acceptConversationA2UIColumnWeights } from './conversationA2UICardWeightTask';
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
  version: '49' | '50' | '51' | '52' | '53' | '54' = '49',
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: version,
    projectStreamedLayout(raw, input) {
      return allowsOrdinaryA2UI(input)
        ? projectConversationA2UISkeleton(
            raw,
            true,
            true,
            version === '51' ||
              version === '52' ||
              version === '53' ||
              version === '54',
          )
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
      const includeVersion =
        version === '51' ||
        version === '52' ||
        version === '53' ||
        version === '54';
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
              ' One atomic updateComponents may change a ready layout, such as replacing a Card and its Column wrapper with a Row of the same exact Text leaves. Detached structural wrappers must be unchanged, already owned by this surface, and never reused; no text, title, or controls may be detached. Keep every accepted answer line in reading order.' +
              (version === '52' || version === '53' || version === '54'
                ? ' Read-only horizontal Lists accept literal cross-axis align: start, center, end, or stretch. No justify, style objects, binding or actions.'
                : '') +
              (version === '53' || version === '54'
                ? ' For a read-only grouped comparison, each Column directly under a Row may use literal weight 1–3 in one static createSurface without a data model.'
                : '') +
              (version === '54'
                ? ' A single native Button can reset the temporary controls in its own final createSurface. Bind its child to one short exact accepted Text line and its action to {"event":{"name":"orot:reset-local-draft","context":{}}}. No data model, other action, or agent event.'
                : ''),
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
      const reset =
        version === '54' &&
        projectConversationA2UIComposedReset(value.a2uiFrames);
      if (reset) {
        const form = previous.validateResult(
          { ...value, a2uiFrames: reset.frames },
          input,
        );
        return form.status === 'valid' &&
          form.value.a2uiPresentation &&
          form.value.answer === accepted.value.answer &&
          bindConversationA2UIComposedReset(form.value.a2uiPresentation, reset)
          ? form
          : accepted;
      }
      const validateFrames = (frames: unknown) =>
        acceptConversationA2UIFrameSequence(
          frames,
          accepted.value.answer,
          true,
          true,
          true,
          version === '52' || version === '53' || version === '54'
            ? 'cross_align'
            : 'vertical_align',
          conversationA2UIFrameProse,
          true,
        );
      const root =
        validateFrames(value.a2uiFrames) ??
        (version === '53' || version === '54'
          ? acceptConversationA2UIColumnWeights(
              value.a2uiFrames,
              validateFrames,
            )
          : undefined);
      return root
        ? { ...accepted, value: { ...accepted.value, a2uiPresentation: root } }
        : accepted;
    },
  };
}
