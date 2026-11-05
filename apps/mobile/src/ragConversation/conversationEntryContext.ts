import type { JsonValue } from '@orot/model-runtime';
import type { EvidenceItem } from '@orot/agent-runtime';

const intents = new Set([
  'conversation',
  'health-summary',
  'possibilities',
  'visit-questions',
  'medical-literature',
]);

/** Only app-selected intent and an admitted evidence alias may cross the model boundary. */
export function conversationEntryContext(
  context: JsonValue | undefined,
  evidence: readonly EvidenceItem[],
) {
  if (!context || typeof context !== 'object' || Array.isArray(context))
    return undefined;
  const object = context as { readonly [key: string]: JsonValue };
  const intent = object.intent;
  if (typeof intent !== 'string' || !intents.has(intent)) return undefined;
  const target = object.targetEvidenceId;
  if (
    target !== undefined &&
    (intent !== 'visit-questions' ||
      typeof target !== 'string' ||
      evidence.filter(item => item.evidenceId === target).length !== 1)
  )
    throw new Error('The selected visit evidence is missing or ambiguous.');
  return {
    intent,
    ...(typeof target === 'string' ? { targetEvidenceId: target } : {}),
  };
}
