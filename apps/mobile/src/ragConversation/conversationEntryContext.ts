import type { JsonValue } from '@orot/model-runtime';
import type { EvidenceItem } from '@orot/agent-runtime';

const intents = new Set([
  'conversation',
  'health-summary',
  'possibilities',
  'visit-questions',
  'medical-literature',
]);

/** The attachment instruction is an app task, never an invented user question. */
export function conversationTaskInput(
  question: string,
  context: JsonValue | undefined,
  evidence: readonly EvidenceItem[],
) {
  const photo =
    context &&
    typeof context === 'object' &&
    !Array.isArray(context) &&
    (context as Readonly<Record<string, JsonValue>>).photoAttachment === true;
  return {
    question,
    entryContext: conversationEntryContext(context, evidence),
    displayTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(photo
      ? {
          attachmentIntent:
            '사용자가 현재 대화에 선택한 사진의 글자를 살펴봐 주세요.',
        }
      : {}),
  };
}

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
