import type { LanguageModelRequest } from '@orot/model-runtime';
import {
  calendarDecisionValues,
  validateCalendarDecisionCandidates,
} from '@orot/provider-openai';
import type { CalendarDecisionCandidate } from '@orot/provider-openai';

/** The runtime bridge accepts only the fixed calendar task, never arbitrary chat or tool prompts. */
export function calendarCandidatesFromRequest(
  request: LanguageModelRequest,
): readonly CalendarDecisionCandidate[] {
  if (
    request.tools?.length ||
    request.toolChoice ||
    request.responseFormat?.name !== 'task_response' ||
    request.messages.length !== 3 ||
    request.messages[0]?.role !== 'system' ||
    request.messages[1]?.role !== 'user' ||
    typeof request.messages[0].content !== 'string' ||
    typeof request.messages[1].content !== 'string'
  )
    throw new Error('Unsupported calendar request');
  const body: unknown = JSON.parse(request.messages[1].content);
  if (
    !record(body) ||
    Object.keys(body).length !== 2 ||
    body.request !==
      'Classify every Calendar candidate in this batch for medical appointment relevance.' ||
    !validateCalendarDecisionCandidates(body.candidates)
  )
    throw new Error('Unsupported calendar request');
  const citationMessage = request.messages[2];
  const citationPrefix =
    'Allowed citation references (return citations as their evidenceId strings; do not invent IDs):\n';
  if (
    citationMessage?.role !== 'user' ||
    typeof citationMessage.content !== 'string' ||
    citationMessage.content !==
      citationPrefix +
        JSON.stringify(body.candidates.map(candidate => candidate.candidateId))
  ) {
    throw new Error('Unsupported calendar citations');
  }
  const schema = request.responseFormat.schema;
  const result = record(schema.properties)
    ? schema
    : Array.isArray(schema.anyOf)
      ? schema.anyOf.find(
          item => record(item) && item.title === 'EvidenceGroundedResult',
        )
      : undefined;
  const props =
    record(result) && record(result.properties) ? result.properties : undefined;
  const value =
    props && record(props.value) && record(props.value.properties)
      ? props.value.properties
      : undefined;
  const rows =
    value && record(value.classifications) ? value.classifications : undefined;
  const item =
    rows && record(rows.items) && record(rows.items.properties)
      ? rows.items.properties
      : undefined;
  const ids =
    item && record(item.candidateId) ? item.candidateId.enum : undefined;
  const decisions =
    item && record(item.decision) ? item.decision.enum : undefined;
  if (
    !rows ||
    rows.minItems !== body.candidates.length ||
    rows.maxItems !== body.candidates.length ||
    !Array.isArray(ids) ||
    ids.length !== body.candidates.length ||
    !body.candidates.every(candidate => ids.includes(candidate.candidateId)) ||
    !Array.isArray(decisions) ||
    decisions.length !== 9 ||
    !calendarDecisionValues.every(decision => decisions.includes(decision))
  )
    throw new Error('Unsupported calendar schema');
  return body.candidates;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
