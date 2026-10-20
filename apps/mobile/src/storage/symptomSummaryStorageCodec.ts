import { isRecordKind } from '@orot/storage';
import type { JsonValue } from '@orot/model-runtime';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { SavedSymptomSummary } from '../diseaseHypotheses/savedSummaries';
import { validateDiseaseHypothesisResult } from '../diseaseHypotheses/resultValidation';
import { MAX_SYMPTOM_SUMMARY_SECTIONS } from '../diseaseHypotheses/types';
import { parseHealthContextScope } from '../healthEvidence/healthContext/scope';

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function reference(value: unknown): value is EvidenceReference {
  return (
    object(value) &&
    ['personal_record', 'reviewed_memory', 'external_medical'].includes(
      String(value.sourceKind),
    ) &&
    [
      'sourceId',
      'sourceRevision',
      'evidenceId',
      'evidenceRevision',
      'reviewState',
    ].every(key => typeof value[key] === 'string') &&
    (value.effectiveTime === null || typeof value.effectiveTime === 'string')
  );
}
/** Corrupt or unsupported rows are unavailable; stored JSON is never trusted as executable source identity. */
export function decodeSavedSymptomSummary(
  serialized: unknown,
): SavedSymptomSummary | null {
  if (typeof serialized !== 'string' || serialized.length > 128_000)
    return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !object(value) ||
      !['id', 'createdAt', 'modelName', 'modelId', 'providerId'].every(
        key => typeof value[key] === 'string' && value[key].length > 0,
      ) ||
      !Number.isFinite(Date.parse(value.createdAt as string)) ||
      !object(value.analysis) ||
      !Array.isArray(value.sources) ||
      value.sources.length > 24
    )
      return null;
    for (const source of value.sources) {
      if (object(source) && source.kind === 'health_context_period') {
        const scope = parseHealthContextScope(source.scope);
        if (
          !scope ||
          !reference(source.reference) ||
          source.reference.sourceKind !== 'personal_record' ||
          JSON.stringify(parseHealthContextScope(source.reference.locator)) !==
            JSON.stringify(scope) ||
          typeof source.revision !== 'string' ||
          !source.revision ||
          source.reference.sourceRevision !== source.revision ||
          source.reference.evidenceRevision !== source.revision ||
          !Number.isSafeInteger(source.deletionGeneration) ||
          Number(source.deletionGeneration) < 0
        )
          return null;
        continue;
      }
      if (
        !object(source) ||
        !reference(source.reference) ||
        (object(source.reference.locator) &&
          source.reference.locator.kind === 'health_context_period') ||
        !Array.isArray(source.records) ||
        source.records.length > 32 ||
        source.records.some(
          record =>
            !object(record) ||
            typeof record.kind !== 'string' ||
            !(isRecordKind(record.kind) || record.kind === 'reviewed_memory') ||
            typeof record.id !== 'string' ||
            typeof record.revision !== 'string',
        )
      )
        return null;
    }
    const refs = value.sources.map(
      source => source.reference as EvidenceReference,
    );
    const validated = validateDiseaseHypothesisResult(
      { hypotheses: value.analysis.hypotheses } as JsonValue,
      {
        request: '',
        evidence: {
          items: refs.map(ref => ({ ...ref, content: '' })),
          coverage: [],
          conflicts: [],
        },
      },
      {
        allowEmptyUncertainty: true,
        maxSections: MAX_SYMPTOM_SUMMARY_SECTIONS,
      },
    );
    if (validated.status !== 'valid') return null;
    return value as unknown as SavedSymptomSummary;
  } catch {
    return null;
  }
}
