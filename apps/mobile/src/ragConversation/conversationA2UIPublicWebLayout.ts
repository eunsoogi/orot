import type {
  EvidenceReference,
  TaskResponderContract,
} from '@orot/agent-runtime';
import { publicWebSources } from '../externalMedicalEvidence/publicWebSources';
import type { ConversationA2UINode } from './conversationA2UI';
import { acceptConversationA2UIFrameSequence } from './conversationA2UIFrameSequence';
import {
  allowsOrdinaryA2UI,
  conversationA2UIFrameProse,
} from './conversationA2UIPresentation';
import { normalizeA2UIObjectFrames } from './conversationA2UIReplacementTask';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

const layouts = new WeakMap<
  GroundedRagAnswer,
  {
    readonly root: ConversationA2UINode;
    readonly evidence: ReadonlySet<string>;
  }
>();

function publicEvidenceKey(reference: EvidenceReference): string | undefined {
  if (!publicWebSources(reference)) return;
  return JSON.stringify([
    reference.evidenceId,
    reference.evidenceRevision,
    reference.sourceId,
    reference.sourceRevision,
  ]);
}

/** The model can propose presentation, not confer source ownership or choose
 * its disclaimer. Only an ordinary, exclusively public-source answer can
 * carry a read-only proposal to the terminal citation boundary. */
export function withPublicWebConversationLayout(
  previous: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '61',
    createResultSchema(input, jsonPrompt) {
      const schema =
        previous.createResultSchema?.(input, jsonPrompt) ??
        previous.resultSchema;
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
              frames.description +
              ' When the answer benefits from an actual native layout, return its frames instead of merely drawing tabs or controls with text. For Tabs put each literal tab title, followed by that panel’s text lines, in the accepted answer in the same order. Ordinary replies grounded only in supplied public-web sources also support read-only layout (such as Tabs containing Lists); keep exact citations in the result envelope, not the surface. Use whole literal answer lines, not added styling or rewritten items. The app adds the public-web disclosure.',
          },
        },
      };
    },
    validateResult(value, input) {
      const result = previous.validateResult(value, input);
      if (
        result.status !== 'valid' ||
        result.value.answerKind !== 'grounded' ||
        result.value.a2uiPresentation ||
        result.value.literatureReferences?.length ||
        result.value.localReferences?.length ||
        input.resultPartition ||
        !allowsOrdinaryA2UI(input) ||
        !input.evidence.items.length
      )
        return result;
      const evidence = new Set<string>();
      for (const item of input.evidence.items) {
        const key = publicEvidenceKey(item);
        if (!key) return result;
        evidence.add(key);
      }
      const normalized = normalizeA2UIObjectFrames(value);
      if (!isObject(normalized)) return result;
      const root = acceptConversationA2UIFrameSequence(
        normalized.a2uiFrames,
        result.value.answer,
        true,
        true,
        true,
        'cross_align',
        conversationA2UIFrameProse,
        true,
      );
      if (root) layouts.set(result.value, { root, evidence });
      return result;
    },
  };
}

/** Keep app-authored notice always visible and outside model-owned panels.
 * The owning terminal caller has already validated these exact citations. */
export function publishPublicWebConversationLayout(
  answer: GroundedRagAnswer,
  citations: readonly EvidenceReference[],
  notice: string,
): ConversationA2UINode | undefined {
  const proposal = layouts.get(answer);
  if (
    !proposal ||
    !citations.length ||
    !citations.every(reference => {
      const key = publicEvidenceKey(reference);
      return key !== undefined && proposal.evidence.has(key);
    })
  )
    return;
  return {
    id: 'orot:public-layout',
    component: 'Column',
    children: [
      proposal.root,
      {
        id: 'orot:public-notice',
        component: 'Text',
        variant: 'body',
        text: notice,
      },
    ],
  };
}
