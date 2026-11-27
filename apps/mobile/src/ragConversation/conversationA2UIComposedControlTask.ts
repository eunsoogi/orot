import type { TaskResponderContract } from '@orot/agent-runtime';
import { projectConversationA2UIComposedControls } from './conversationA2UIComposedControlFrames';
import { bindConversationA2UIComposedControls } from './conversationA2UIComposedControlState';
import { allowsOrdinaryA2UI } from './conversationA2UIPresentation';
import { isObject } from './taskHistory';
import type { GroundedRagAnswer } from './task';

export function withComposedConversationControls(
  legacy: TaskResponderContract<GroundedRagAnswer>,
  version: '45' | '46' | '47' = '45',
  timeControls = false,
): TaskResponderContract<GroundedRagAnswer> {
  const sliders = version !== '45';
  const dateControls = version === '47';
  return {
    ...legacy,
    taskVersion: version,
    createResultSchema(input) {
      const schema = legacy.createResultSchema?.(input) ?? legacy.resultSchema;
      if (!allowsOrdinaryA2UI(input) || !isObject(schema.properties))
        return schema;
      const frames = schema.properties.a2uiFrames;
      if (!isObject(frames) || typeof frames.description !== 'string')
        return schema;
      return {
        ...schema,
        properties: {
          ...schema.properties,
          a2uiFrames: {
            ...frames,
            description:
              'For an ordinary reply, optionally compose a native A2UI 1.0 layout. Use an ordered array of JSON message strings and a root component with id "root". Start with createSurface on "orot:response:draft" and the bundled Basic catalog "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json". Use updateComponents or updateDataModel as needed; deleteSurface returns to prose. ' +
              'Arrange Text, Card, Column, Row, List, Divider, supported icons and Tabs as the answer needs. Text may use supported inline emphasis and literal supported alignment; Row text or cards may specify a supported size weight. Keep accepted answer lines once in reading order as the text fallback. ' +
              'Use any mix of CheckBox, shortText TextField, and mutuallyExclusive or multipleSelection ChoicePicker among the layout nodes. Put their definitions directly in createSurface or updateComponents and reference their IDs where they should appear. Compose natural labels, choose distinct option tokens within the bundled catalog budget, and give each control a distinct value binding such as {"@path":"/form/choice"}. ' +
              'These pointers describe the bubble only; they are never app or account paths. Controls start empty, with no required seed, root layout, prose count, ordering, or pairing. All edits stay in this bubble. Omit actions, remote content, and sendDataModel, or set sendDataModel to false.' +
              (sliders
                ? ' A Slider can be composed alongside those controls. Give a plain label, distinct local value pointer, integer min (defaults to 0) and max in [-1000, 1000] with max greater than min, and optionally 1–100 equal divisions in steps. It starts at min; do not seed its value or supply actions.'
                : '') +
              (dateControls
                ? ' A temporary DateTimeInput may choose a date without scheduling it. Use a distinct local value pointer, plain label, enableDate:true, no enableTime, and literal ISO YYYY-MM-DD min/max between 1900-01-01 and 2100-12-31 with min before max. It starts empty; no seeds, actions, or calendar access.'
                : '') +
              (timeControls
                ? ' A temporary time-only DateTimeInput may select a wall-clock time without scheduling. Use enableTime:true, omit enableDate or set it to false, provide a distinct local value pointer and a literal label. Omit bounds, model seeds, actions and time zones.'
                : ''),
          },
        },
      };
    },
    validateResult(value, input) {
      const ordinary = legacy.validateResult(value, input);
      if (
        ordinary.status !== 'valid' ||
        ordinary.value.answerKind !== 'conversation' ||
        ordinary.value.a2uiPresentation ||
        !allowsOrdinaryA2UI(input) ||
        !isObject(value)
      )
        return ordinary;
      const plan = projectConversationA2UIComposedControls(
        value.a2uiFrames,
        sliders,
        dateControls,
        timeControls,
      );
      if (!plan) return ordinary;
      const result = legacy.validateResult(
        { ...value, a2uiFrames: plan.frames },
        input,
      );
      if (
        result.status !== 'valid' ||
        result.value.answerKind !== 'conversation' ||
        !result.value.a2uiPresentation ||
        result.value.a2uiLocalDraft ||
        !bindConversationA2UIComposedControls(
          result.value.a2uiPresentation,
          plan.controls,
        )
      )
        return ordinary;
      return result;
    },
  };
}
