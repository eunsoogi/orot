import type { ConversationArtifactSource } from '../ragConversation/conversationArtifactSources';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import type { TreatmentContext } from './types';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= 1000;
const texts = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 24 && value.every(text);
const fields = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every(key => keys.includes(key));

/** The enclosing artifact decoder validates the source inventory before this check. */
export function hasValidTreatmentContext(
  value: Record<string, unknown>,
): boolean {
  return (
    value.treatmentContext === undefined ||
    !!parseTreatmentContext(
      value.treatmentContext,
      value.sources as ConversationArtifactSource[],
    )
  );
}

function timestamp(value: unknown, day: boolean): boolean {
  if (
    typeof value !== 'string' ||
    !(
      day
        ? /^\d{4}-\d{2}-\d{2}$/u
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u
    ).test(value)
  )
    return false;
  const time = Date.parse(value);
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, day ? 10 : 19) ===
      value.slice(0, day ? 10 : 19)
  );
}

/** Reject unknown or unbound saved fields before exposing a treatment context. */
export function parseTreatmentContext(
  value: unknown,
  sources: readonly ConversationArtifactSource[],
): TreatmentContext | null {
  if (
    !object(value) ||
    !fields(value, [
      'version',
      'conditions',
      'clinicianPlans',
      'publicEvidence',
      'missingContext',
      'conflicts',
    ]) ||
    value.version !== 1 ||
    !Array.isArray(value.conditions) ||
    value.conditions.length > 24 ||
    !Array.isArray(value.publicEvidence) ||
    value.publicEvidence.length > 24 ||
    !texts(value.missingContext) ||
    !texts(value.conflicts)
  )
    return null;
  const sourceFor = (reference: unknown) =>
    sources.find(
      source => stableJson(source.reference) === stableJson(reference),
    );
  if (!object(value.clinicianPlans)) return null;
  if (value.clinicianPlans.status === 'unavailable') {
    if (!fields(value.clinicianPlans, ['status'])) return null;
  } else if (value.clinicianPlans.status === 'source_records') {
    const plans = value.clinicianPlans.sources;
    if (
      !fields(value.clinicianPlans, ['status', 'sources']) ||
      !Array.isArray(plans) ||
      !plans.length ||
      plans.length > 24
    )
      return null;
    for (const plan of plans) {
      if (
        !object(plan) ||
        !fields(plan, ['reference', 'record']) ||
        !object(plan.record) ||
        !fields(plan.record, ['kind', 'id', 'revision']) ||
        plan.record.kind !== 'source_record' ||
        !text(plan.record.id) ||
        !text(plan.record.revision)
      )
        return null;
      const source = sourceFor(plan.reference);
      if (
        !source ||
        source.reference.sourceKind !== 'personal_record' ||
        !('records' in source) ||
        !source.records.some(
          record => stableJson(record) === stableJson(plan.record),
        )
      )
        return null;
    }
  } else return null;
  const references = (items: unknown): items is unknown[] =>
    Array.isArray(items) &&
    items.length <= 24 &&
    items.every(reference => !!sourceFor(reference)) &&
    new Set(items.map(stableJson)).size === items.length;
  for (const condition of value.conditions) {
    if (!object(condition) || !text(condition.uncertainty)) return null;
    if (condition.status === 'ai_possibility') {
      if (
        !fields(condition, [
          'status',
          'title',
          'supportingEvidence',
          'contraryEvidence',
          'uncertainty',
          'missingData',
        ]) ||
        !text(condition.title) ||
        !references(condition.supportingEvidence) ||
        !condition.supportingEvidence.length ||
        !references(condition.contraryEvidence) ||
        !texts(condition.missingData)
      )
        return null;
      // Medication-only data, literature, and generated artifacts do not independently support a personal possibility.
      if (
        !condition.supportingEvidence.some(ref => {
          const source = sourceFor(ref);
          return (
            source?.reference.sourceKind === 'personal_record' &&
            'records' in source &&
            source.records.some(
              record =>
                record.kind !== 'medication_definition' &&
                record.kind !== 'dose_event',
            )
          );
        })
      )
        return null;
      if (
        [...condition.supportingEvidence, ...condition.contraryEvidence].some(
          ref => sourceFor(ref)?.reference.sourceKind === 'generated_artifact',
        )
      )
        return null;
      const contrary = condition.contraryEvidence;
      if (
        condition.supportingEvidence.some(ref =>
          contrary.some(other => stableJson(ref) === stableJson(other)),
        )
      )
        return null;
    } else if (
      condition.status === 'clinician_recorded' ||
      condition.status === 'user_reported'
    ) {
      if (
        !fields(condition, ['status', 'source', 'record', 'uncertainty']) ||
        !object(condition.record) ||
        !fields(condition.record, ['kind', 'id', 'revision']) ||
        !['health_observation', 'manual_history'].includes(
          String(condition.record.kind),
        ) ||
        !text(condition.record.id) ||
        !text(condition.record.revision)
      )
        return null;
      const source = sourceFor(condition.source);
      if (
        !source ||
        source.reference.sourceKind !== 'personal_record' ||
        !('records' in source) ||
        !source.records.some(
          record => stableJson(record) === stableJson(condition.record),
        )
      )
        return null;
    } else return null;
  }
  for (const item of value.publicEvidence) {
    if (
      !object(item) ||
      !fields(item, [
        'reference',
        'originalUrl',
        'publicationDate',
        'retrievedAt',
        'sourceType',
        'population',
        'limitations',
        'availability',
      ]) ||
      !text(item.originalUrl) ||
      !timestamp(item.retrievedAt, false) ||
      !(
        item.publicationDate === null || timestamp(item.publicationDate, true)
      ) ||
      !(item.sourceType === null || text(item.sourceType)) ||
      !(item.population === null || text(item.population)) ||
      !texts(item.limitations) ||
      !['abstract', 'full_text', 'metadata_only', 'unknown'].includes(
        String(item.availability),
      )
    )
      return null;
    const source = sourceFor(item.reference);
    const locator = source?.reference.locator;
    if (
      source?.reference.sourceKind !== 'external_medical' ||
      !object(locator) ||
      locator.originalUrl !== item.originalUrl ||
      locator.retrievedAt !== item.retrievedAt ||
      (locator.publicationDate ?? null) !== item.publicationDate ||
      (locator.sourceType ?? null) !== item.sourceType ||
      (locator.population ?? null) !== item.population ||
      (locator.availability ?? 'unknown') !== item.availability ||
      stableJson(locator.limitations ?? []) !== stableJson(item.limitations)
    )
      return null;
    try {
      const url = new URL(item.originalUrl);
      if (url.protocol !== 'https:' || url.username || url.password)
        return null;
    } catch {
      return null;
    }
  }
  return value as unknown as TreatmentContext;
}
