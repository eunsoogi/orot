import { serializeSourceConversationReport } from './sourceConversationReportTemplate';
import { renderMixedEvidenceAnswer } from './mixedEvidenceAnswer';
import type { JsonObject, JsonValue } from '@orot/model-runtime';
import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import type { GroundedRagAnswer } from './task';
import { t } from '../i18n';
import { isObject } from './taskHistory';
import {
  possibilityReportTemplate,
  parseConversationReport,
} from './conversationReportTemplate';

const fields = [
  'observations',
  'explanations',
  'evidence',
  'unknowns',
  'nextSteps',
];

/** Recognize the app choice and its visible request, not every follow-up in a possibility session. */
export function requestsPossibilityReport(
  input: Pick<TaskResponderInput, 'request' | 'context'>,
) {
  return (
    input.request.trim() === t('conversationActions.possibilities') ||
    input.request.trim() === t('conversationTemplate.possibilities.title') ||
    (isObject(input.context) &&
      input.context.intent === 'possibilities' &&
      input.request === t('conversationIntent.possibilities'))
  );
}

function serializeReport(value: JsonValue): string | undefined {
  if (
    !isObject(value) ||
    Object.keys(value).length !== fields.length ||
    !fields.every(
      field =>
        typeof value[field] === 'string' && (value[field] as string).trim(),
    )
  )
    return undefined;
  const template = possibilityReportTemplate();
  // Labels are application-owned. Bodies are retained verbatim and pass the same clinical/citation gates as prose.
  return `# ${template.title}\n\n${fields.map((field, i) => `## ${template.sections[i]}\n${value[field]}`).join('\n\n')}`;
}

/** New task contracts require data fields rather than hoping the model writes exact Markdown.
 * Legacy checkpoints keep their original task, schema and prompts through the version registry. */
export function withStructuredPossibilityReport(
  base: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...base,
    taskVersion: '15',
    // Only current tasks adopt complete-history defaults; restored v14 prompts stay byte-identical.
    systemPrompt: base.systemPrompt
      .replace(
        'local-health-context (30 days, summary detail by default)',
        'local-health-context (all available imported history, summary detail by default)',
      )
      .replace(
        'Choose 7 or 90 days, or an explicit window for a requested period,',
        'Choose a positive day count or an explicit window only for a requested period,',
      )
      .replace(
        'exclusive end, at most 90 local calendar days.',
        'exclusive end.',
      ),
    correctionInstructionForInvalidResult(reason) {
      if (reason !== 'The requested possibility report was not structured.')
        return base.correctionInstructionForInvalidResult?.(reason);
      return 'Return the complete result envelope again. For this requested grounded report, answer must contain observations, explanations, evidence, unknowns and nextSteps as nonempty Korean body strings, without Markdown headings. Preserve current evidence, citations and clinical uncertainty. Never invent content to fill a section; state unknowns. For a genuine clarification or refusal use answerKind=conversation and a plain string.';
    },
    createMessages(input) {
      const messages = base.createMessages(input);
      if (!requestsPossibilityReport(input)) return messages;
      return messages.map(message => {
        if (message.role !== 'user' || typeof message.content !== 'string')
          return message;
        const payload = JSON.parse(message.content);
        payload.answerTemplate = {
          format:
            'For a grounded possibility report without literature/localClaims fields, answer must be an object with observations, explanations, evidence, unknowns, nextSteps. Write Korean body text only, no report headings. Separate reported facts, tentative explanations, supporting/opposing evidence, unknowns and questions for a clinician. State unknowns instead of inventing content. For clarification, safety refusal or prior_output, keep a plain string answer. When literature/localClaims are required, keep the existing exact-source contract; the application renders those validated sources as a report, not an unsupported personal diagnosis.',
        };
        return { ...message, content: JSON.stringify(payload) };
      });
    },
    createResultSchema(input): JsonObject {
      const schema = base.createResultSchema?.(input) ?? base.resultSchema!;
      if (!requestsPossibilityReport(input)) return schema;
      const properties = schema.properties as JsonObject;
      // Literature keeps its exact-source schema; the validator, not model prose, composes that report.
      if ('literature' in properties) return schema;
      return {
        ...schema,
        properties: {
          ...properties,
          answer: {
            anyOf: [
              properties.answer!,
              {
                type: 'object',
                required: fields,
                properties: Object.fromEntries(
                  fields.map(field => [
                    field,
                    { type: 'string', minLength: 1 },
                  ]),
                ),
                additionalProperties: false,
              },
            ],
            description:
              'For grounded possibility reports use the structured object. Strings are only for clarification, refusal, prior output or exact-source literature/localClaims rendering.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (
        !requestsPossibilityReport(input) ||
        !isObject(value) ||
        value.answerKind !== 'grounded'
      )
        return base.validateResult(value, input);
      if ('literature' in value || 'localClaims' in value) {
        const result = base.validateResult(value, input);
        if (result.status !== 'valid') return result;
        const report = renderMixedEvidenceAnswer(
          value,
          input.evidence.items,
          input.request,
        )!;
        // Never restore discarded free-text medical claims. Only the already source-validated answer is presented.
        return {
          ...result,
          value: {
            ...result.value,
            answer: serializeSourceConversationReport(
              report.sections,
              result.value.answer,
            ),
          },
        };
      }
      const answer = serializeReport(value.answer!);
      if (!answer || !parseConversationReport(answer))
        return {
          status: 'invalid',
          reason: 'The requested possibility report was not structured.',
        };
      return base.validateResult({ ...value, answer }, input);
    },
  };
}
