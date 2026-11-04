import type { JsonObject, JsonValue } from '@orot/model-runtime';
import type { TaskResponderContract } from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from './types';
import { overviewSelectionSchema } from './summaryOverviewSchema';
import {
  overviewSelectionSources,
  resolveOverviewSelections,
} from './summaryOverviewSelections';
import { noteOmittedSummaryContent } from './summaryPartialValidation';

/** Production wrapper binds supported grouped quantities to source rows before the normal safety validator. */
export function withSourceBoundOverview(
  base: TaskResponderContract<DiseaseHypothesisAnalysis>,
): TaskResponderContract<DiseaseHypothesisAnalysis> {
  const partition = base.finalResultPartition;
  return {
    ...base,
    taskVersion: `${base.taskVersion}.overview1`,
    createResultSchema(input) {
      const schema = base.createResultSchema?.(input) ?? base.resultSchema;
      return overviewSelectionSchema(input, schema) ?? schema;
    },
    createMessages(input) {
      const messages = base.createMessages(input);
      const sources = overviewSelectionSources(input);
      if (!sources) return messages;
      return [
        ...messages,
        {
          role: 'user',
          content: JSON.stringify({
            instruction:
              'For the source IDs in rowOptions select source-relative row keys only; do not write prose or values for those sources. Use limitationCodes only for the supplied subset limitation. Use sections for other sources with their exact IDs. Cite exact used source IDs.',
            rowOptions: sources.map(source => ({
              sourceId: source.item.evidenceId,
              rows: source.rows.map((row, index) => ({
                rowKey: `r${index}`,
                concept: row.label,
              })),
            })),
          }),
        },
      ];
    },
    projectStreamedText(raw, input) {
      // Incomplete selectors do not yet identify publishable source-bound facts.
      return overviewSelectionSources(input)
        ? undefined
        : base.projectStreamedText?.(raw, input);
    },
    validateResult(value, input) {
      if (!overviewSelectionSources(input))
        return base.validateResult(value, input);
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('recordSelections' in value)
      )
        return {
          status: 'invalid',
          reason: 'Expected source-bound record selections.',
        };
      const record = value as Record<string, JsonValue>;
      const selected = resolveOverviewSelections(record, input);
      if (!selected)
        return {
          status: 'invalid',
          reason: 'Expected valid source-bound record selections.',
        };
      const verified = base.validateResult(
        {
          sections: selected.sections,
          ...(record.coverageNotes === undefined
            ? {}
            : { coverageNotes: record.coverageNotes }),
        },
        selected.input,
      );
      if (verified.status !== 'valid') return verified;
      return selected.omitted
        ? noteOmittedSummaryContent(verified.value)
        : verified;
    },
    ...(partition
      ? {
          finalResultPartition: {
            ...partition,
            mergeValues(values, input) {
              if (
                !values.some(
                  value =>
                    value &&
                    typeof value === 'object' &&
                    !Array.isArray(value) &&
                    'recordSelections' in value,
                )
              )
                return partition.mergeValues(values, input);
              const recordSelections: JsonValue[] = [];
              const sections: JsonValue[] = [];
              const coverageNotes = new Set<string>();
              for (const value of values) {
                if (!value || typeof value !== 'object' || Array.isArray(value))
                  throw new Error('Expected validated summary group.');
                const group = value as JsonObject;
                if (group.recordSelections !== undefined) {
                  if (!Array.isArray(group.recordSelections))
                    throw new Error('Expected record selections.');
                  recordSelections.push(...group.recordSelections);
                }
                if (group.sections !== undefined) {
                  if (!Array.isArray(group.sections))
                    throw new Error('Expected summary sections.');
                  sections.push(...group.sections);
                }
                if (group.coverageNotes !== undefined) {
                  if (
                    !Array.isArray(group.coverageNotes) ||
                    group.coverageNotes.some(note => typeof note !== 'string')
                  )
                    throw new Error('Expected coverage notes.');
                  for (const note of group.coverageNotes)
                    coverageNotes.add(note as string);
                }
              }
              return {
                recordSelections,
                ...(sections.length ? { sections } : {}),
                ...(coverageNotes.size
                  ? { coverageNotes: [...coverageNotes] }
                  : {}),
              };
            },
          },
        }
      : {}),
  };
}
