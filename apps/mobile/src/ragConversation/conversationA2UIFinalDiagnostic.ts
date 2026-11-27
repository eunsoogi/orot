import { NativeModules } from 'react-native';
import type {
  MultiAgentWorkflowOptions,
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { providerDiagnostic } from '../providers/diagnostics';
import { allowsOrdinaryA2UI } from './conversationA2UIPresentation';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

type Admission = 'a2ui_no_frames' | 'a2ui_invalid_frames' | 'a2ui_admitted';

// Only the exact validated result can carry a category to the terminal workflow.
// Unpublished candidates are weakly held; no content is retained or serialized here.
const decisions = new WeakMap<GroundedRagAnswer, Admission>();

function diagnosticEnabled() {
  try {
    return NativeModules.OrotProviderDiagnostics?.enabled === true;
  } catch {
    return false;
  }
}

export function observeConversationA2UIFinalAdmission(
  task: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...task,
    validateResult(value, input) {
      const result = task.validateResult(value, input);
      if (
        diagnosticEnabled() &&
        result.status === 'valid' &&
        result.value.answerKind === 'conversation' &&
        allowsOrdinaryA2UI(input)
      ) {
        const frames = isObject(value) ? value.a2uiFrames : undefined;
        decisions.set(
          result.value,
          result.value.a2uiPresentation
            ? 'a2ui_admitted'
            : frames === undefined || (Array.isArray(frames) && !frames.length)
              ? 'a2ui_no_frames'
              : 'a2ui_invalid_frames',
        );
      }
      return result;
    },
  };
}

export function reportConversationA2UIFinalAdmission(
  answer: GroundedRagAnswer,
) {
  const decision = decisions.get(answer);
  if (!decision) return;
  decisions.delete(answer);
  try {
    providerDiagnostic('rag', 'conversation_a2ui_final_admission', decision);
  } catch {
    // Diagnostic failures cannot change the accepted reply.
  }
}

/** Opt-in grounded layout events carry only fixed decisions, never evidence. */
export function reportConversationA2UIPublicDecision(
  ...[stage, outcome]:
    | ['conversation_a2ui_public_proposal', Admission]
    | [
        'conversation_a2ui_public_publication',
        'a2ui_no_proposal' | 'a2ui_citation_mismatch' | 'a2ui_published',
      ]
) {
  try {
    if (diagnosticEnabled()) providerDiagnostic('rag', stage, outcome);
  } catch {
    // Display and source admission never depend on local diagnostics.
  }
}

/** A React commit is not proof of native paint or local-control availability. */
export function reportConversationA2UIReactCommit() {
  try {
    if (diagnosticEnabled())
      providerDiagnostic('rag', 'conversation_a2ui_react_commit', 'completed');
  } catch {
    // Diagnostic failures cannot prevent rendering.
  }
}

/** The per-run hint is diagnostic only, not a provider authorization check. */
export function conversationA2UIPlanEnvelopeProbe(
  {
    execution,
    provider,
  }: Pick<MultiAgentWorkflowOptions, 'execution' | 'provider'>,
  context: TaskResponderInput['context'],
): MultiAgentWorkflowOptions['decodedPropertyProbe'] {
  if (
    !diagnosticEnabled() ||
    !allowsOrdinaryA2UI({ context }) ||
    execution.providerId !== provider.id ||
    !provider.id.startsWith('chatgpt-plan:') ||
    provider.capabilities.structuredOutput
  )
    return undefined;
  return {
    property: 'a2uiFrames',
    report(outcome) {
      providerDiagnostic('rag', 'conversation_a2ui_plan_envelope', outcome);
    },
  };
}
