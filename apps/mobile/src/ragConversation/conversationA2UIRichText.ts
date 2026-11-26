import type { TaskResponderContract } from '@orot/agent-runtime';
import type { ConversationA2UINode } from './conversationA2UI';
import {
  allowsOrdinaryA2UI,
  conversationA2UIProse,
} from './conversationA2UIPresentation';
import { acceptConversationA2UIFrameSequence } from './conversationA2UIFrameSequence';
import { isObject } from './taskHistory';
import { markdownRuns, type MarkdownRun } from './conversationMarkdownInline';
import type { GroundedRagAnswer } from './task';

const layouts = new WeakMap<ConversationA2UINode, readonly MarkdownRun[]>();
export const conversationA2UIRichText = (node: ConversationA2UINode) =>
  layouts.get(node);

function richRuns(text: string) {
  if (/[\\[\]<>\r]/u.test(text)) return;
  const runs = markdownRuns(text);
  if (runs.some(run => run.kind === 'link')) return;
  if (!conversationA2UIProse(runs.map(run => run.text).join(''))) return;
  return runs;
}

function richProse(answer: string) {
  if (!answer || answer.length > 8_192) return;
  const lines = answer.split(/\n\n?/u);
  return lines.every(richRuns) ? lines : undefined;
}

function collectNativeProse(
  node: ConversationA2UINode,
  marked: Map<ConversationA2UINode, readonly MarkdownRun[]>,
): boolean {
  if (node.component === 'Text') {
    const runs = richRuns(node.text);
    if (!runs) return false;
    if (runs.some(run => run.kind !== 'text')) marked.set(node, runs);
  } else if (node.component === 'Tabs') {
    return node.tabs.every(
      tab =>
        conversationA2UIProse(tab.title) &&
        collectNativeProse(tab.child, marked),
    );
  } else if ('children' in node) {
    return node.children.every(child => collectNativeProse(child, marked));
  }
  return true;
}

const instruction =
  ' Markup is only allowed in the final ordinary static layout, in body Text. ' +
  'Use only matching simple strong, emphasis, and inline code. Use exactly one createSurface, with raw Text and answer lines identical. ' +
  'Tab titles remain plain. Do not send HTML, links, images, URL destinations, bindings or actions with formatted Text.';

function isStaticRichFrame(raw: unknown): boolean {
  if (
    !Array.isArray(raw) ||
    raw.length !== 1 ||
    typeof raw[0] !== 'string' ||
    raw[0].length > 16_384
  )
    return false;
  try {
    const frame: unknown = JSON.parse(raw[0]);
    return (
      isObject(frame) &&
      isObject(frame.createSurface) &&
      !Object.hasOwn(frame.createSurface, 'dataModel')
    );
  } catch {
    return false;
  }
}

/** The ordinary validator owns the unchanged raw answer, evidence and result
 * policy. Only this fresh version admits the new final presentation branch. */
export function withConversationA2UIRichText(
  base: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...base,
    taskVersion: '40',
    createResultSchema(input) {
      const schema = base.createResultSchema!(input);
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
              frames.description.replace('no markup, URLs', 'no URLs') +
              instruction,
          },
        },
      };
    },
    validateResult(value, input) {
      const result = base.validateResult(value, input);
      if (
        result.status !== 'valid' ||
        result.value.answerKind !== 'conversation' ||
        result.value.a2uiPresentation ||
        !allowsOrdinaryA2UI(input) ||
        !isObject(value) ||
        !isStaticRichFrame(value.a2uiFrames)
      )
        return result;
      const root = acceptConversationA2UIFrameSequence(
        value.a2uiFrames,
        result.value.answer,
        true,
        false,
        false,
        false,
        richProse,
      );
      const marked = new Map<ConversationA2UINode, readonly MarkdownRun[]>();
      if (!root || !collectNativeProse(root, marked) || !marked.size)
        return result;
      for (const [node, runs] of marked) layouts.set(node, runs);
      return { ...result, value: { ...result.value, a2uiPresentation: root } };
    },
  };
}
