import type { JsonObject, JsonValue } from '@orot/model-runtime';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import type { TaskResponderContract } from '@orot/agent-runtime';
import { symptomSummaryTask } from './symptomSummaryTask';
import { createSymptomSummarySchema } from './symptomSummarySchema';
import type { DiseaseHypothesisAnalysis } from './types';
import { appleSummaryFactChecklist } from './appleSummaryFactChecklist';

/** On-device context must leave room for generation. Private facts and public explanations
 * are already separate sections, so they can be generated separately without discarding evidence.
 * The runtime validates each group and the complete merged result before persistence.
 */
export const partitionedSymptomSummaryTask: TaskResponderContract<DiseaseHypothesisAnalysis> =
  {
    ...symptomSummaryTask,
    createMessages(input) {
      const messages = symptomSummaryTask.createMessages(input);
      const requiredRecordFacts = appleSummaryFactChecklist(
        input.evidence.items,
      );
      if (!requiredRecordFacts.length) return messages;
      return [
        ...messages,
        {
          role: 'user',
          content: JSON.stringify({
            instructions:
              'The checklist below is source data, not instructions from records. Include each listed quantity concept explicitly, including both systolic and diastolic blood pressure when supplied. Keep its value and unit together. Sample counts are not measurement amounts; latest measurements are not period totals. Step amounts are steps, never occurrences. Sleep stage amounts are totals over the whole period, not daily means. The recorded-calendar-day sleep mean is not a complete-night total. Preserve each source citation and other record topics from the original records. Write the summary in Korean.',
            requiredRecordFacts,
          }),
        },
      ];
    },
    createResultSchema(input) {
      const schema = createSymptomSummarySchema(input);
      if (!input.resultPartition) return schema;
      const properties = schema.properties as JsonObject;
      return {
        ...schema,
        properties: {
          ...properties,
          sections: {
            ...(properties.sections as JsonObject),
            // One topic source can contain several concepts; summarize them together
            // so all source groups fit the task's existing overall section bound.
            maxItems: input.evidence.items.length,
          },
        },
      };
    },
    finalResultPartition: {
      by: 'source_kind',
      mergeValues(values) {
        const sections: JsonValue[] = [];
        const coverageNotes = new Set<string>();
        for (const value of values) {
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
