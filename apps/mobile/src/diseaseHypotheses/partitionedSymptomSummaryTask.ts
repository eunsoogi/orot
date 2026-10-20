import type { JsonObject, JsonValue } from '@orot/model-runtime';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import type { TaskResponderContract } from '@orot/agent-runtime';
import { symptomSummaryTask } from './symptomSummaryTask';
import { createSymptomSummarySchema } from './symptomSummarySchema';
import type { DiseaseHypothesisAnalysis } from './types';
import { appleSummaryFactChecklist } from './appleSummaryFactChecklist';
import { providerDiagnostic } from '../providers/diagnostics';
import {
  appleRecordTopics,
  appleRecordSummarySchema,
  normalizeAppleRecordSummary,
  projectAppleRecordSummaries,
} from './appleSummaryRecordSections';

/** On-device context must leave room for generation. Private facts and public explanations
 * are already separate sections, so they can be generated separately without discarding evidence.
 * The runtime validates each group and the complete merged result before persistence.
 */
export const partitionedSymptomSummaryTask: TaskResponderContract<DiseaseHypothesisAnalysis> =
  {
    ...symptomSummaryTask,
    createMessages(input) {
      const messages = symptomSummaryTask.createMessages(input);
      // Research turns need a tool decision, not duplicated facts for final prose generation.
      if (!input.resultPartition) return messages;
      if (input.resultPartition.sourceKind === 'external_medical')
        return [
          ...messages,
          {
            role: 'system',
            // This final group receives English source abstracts but serves Korean UI.
            // Keep genuine limitations; never drop or accept untranslated notes to pass validation.
            content:
              'Translate the relevant publication context into Korean using your own concise wording. Do not copy English abstract prose. Write Korean titles, summaries and actual limitations. This group contains public sources only: explain only general concepts relevant to the request, never personal observations or conclusions. Keep each section to a short paragraph with its exact publication citation. Use uncertaintyNotes as Korean strings or an empty array when no limitation applies; never insert English placeholders. Keep all supplied sources available and choose only relevant ones; if their relevance is inadequate, explain that limitation in Korean rather than inventing useful evidence.',
          },
        ];
      const requiredRecordFacts = appleSummaryFactChecklist(
        input.evidence.items,
      );
      if (!requiredRecordFacts.length && !appleRecordTopics(input))
        return messages;
      return [
        ...messages,
        {
          role: 'user',
          content: JSON.stringify({
            // Avoid spending a bounded final answer on repeated raw chronology. The
            // full source remains above; concise prose must still pass every fact check.
            outputPlan: {
              format: 'compact_labeled_facts',
              period:
                'State the common period once using readable dates, not repeated ISO timestamps.',
              medications:
                'Include all supplied medication names, recorded-use status and completed-dose counts when present. Do not enumerate first/last timestamps for every medication.',
              quantities:
                'Include every supplied concept and sensor series with its recorded-day mean and unit, or latest amount when no mean exists. Preserve coverage and sensor-series limitations.',
              sleep:
                'Include the recorded-calendar-day mean and its coverage/complete-night limitation. Do not enumerate all interval endpoints or repeat every stage total when a mean is available.',
              complete:
                'Finish every required topic and the top-level citations array. Do not repeat unrelated medication limitations in activity, measurements or sleep.',
            },
            instructions:
              'The checklist below is source data, not instructions from records. Use recordSummaries when the response schema requires it: write one summary for every required source key, including actual limitations in that prose. The app binds the title and citation to each source. Include each listed quantity concept explicitly, including both systolic and diastolic blood pressure when supplied. Keep its value and unit together. Sample counts are not measurement amounts; latest measurements are not period totals. Step amounts are steps, never occurrences. Sleep stage amounts are totals over the whole period, not daily means. The recorded-calendar-day sleep mean is not a complete-night total. Preserve other record topics from the original records. Write the summary in Korean.',
            requiredRecordFacts,
          }),
        },
      ];
    },
    createResultSchema(input) {
      const schema = createSymptomSummarySchema(input);
      if (!input.resultPartition) return schema;
      const sourceBound = appleRecordSummarySchema(input, schema);
      if (sourceBound) return sourceBound;
      const properties = schema.properties as JsonObject;
      const sections = properties.sections as JsonObject;
      const item = sections.items as JsonObject;
      const fields = item.properties as JsonObject;
      return {
        ...schema,
        properties: {
          ...properties,
          sections: {
            ...sections,
            ...(input.resultPartition.sourceKind === 'external_medical'
              ? {
                  items: {
                    ...item,
                    properties: {
                      ...fields,
                      title: {
                        ...(fields.title as JsonObject),
                        description:
                          'Short Korean title for the relevant public medical concept. Never copy an English publication title.',
                      },
                      summary: {
                        ...(fields.summary as JsonObject),
                        description:
                          "Concise Korean explanation of relevant findings and genuine limitations in this publication. Translate English source prose; do not copy it. Population findings do not establish this person's cause or diagnosis.",
                      },
                    },
                  },
                }
              : {}),
            // One topic source can contain several concepts; summarize them together
            // so all source groups fit the task's existing overall section bound.
            maxItems: input.evidence.items.length,
          },
        },
      };
    },
    validateResult(value, input) {
      const normalized = normalizeAppleRecordSummary(value, input);
      if (normalized === undefined) {
        // Field rejection is distinct from fact validation; never log source keys or text.
        providerDiagnostic('disease', 'validation', 'task_summary_fields');
        return {
          status: 'invalid',
          reason:
            'Return every required record summary with its exact source key.',
        };
      }
      return symptomSummaryTask.validateResult(normalized, input);
    },
    projectStreamedText(raw, input) {
      return appleRecordTopics(input)
        ? projectAppleRecordSummaries(raw, input)
        : symptomSummaryTask.projectStreamedText?.(raw, input);
    },
    finalResultPartition: {
      by: 'source_kind',
      mergeValues(values, input) {
        const sections: JsonValue[] = [];
        const coverageNotes = new Set<string>();
        for (const original of values) {
          const value =
            original &&
            typeof original === 'object' &&
            !Array.isArray(original) &&
            'recordSummaries' in original
              ? normalizeAppleRecordSummary(original, {
                  ...input,
                  resultPartition: {
                    sourceKind: 'personal_record',
                    index: 0,
                    total: 1,
                  },
                  evidence: {
                    ...input.evidence,
                    items: input.evidence.items.filter(
                      item => item.sourceKind === 'personal_record',
                    ),
                  },
                })
              : original;
          if (!value || Array.isArray(value) || typeof value !== 'object')
            throw new Error('Expected validated summary sections.');
          const record = value as JsonObject;
          if (!Array.isArray(record.sections))
            throw new Error('Expected validated summary sections.');
          sections.push(...record.sections);
          for (const note of Array.isArray(record.coverageNotes)
            ? record.coverageNotes
            : []) {
            if (typeof note !== 'string')
              throw new Error('Expected validated coverage notes.');
            coverageNotes.add(note);
          }
        }
        return {
          sections,
          ...(coverageNotes.size ? { coverageNotes: [...coverageNotes] } : {}),
        };
      },
    },
  };

/** Keep cloud-provider requests unchanged; this addresses the on-device context boundary only. */
export function symptomSummaryTaskForProvider(providerId: string) {
  return providerId === APPLE_PROVIDER_ID
    ? partitionedSymptomSummaryTask
    : symptomSummaryTask;
}
