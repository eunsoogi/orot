import type { VisitQuestionEvidenceCollection } from '../src/agent/visitQuestions/evidenceCollection';
import { visitQuestionCitationKey } from '../src/agent/visitQuestions/evidence';
import type { LanguageModelRequest } from '@orot/model-runtime';

// Identifiers are fixture constants and never included in diagnostic output.
export const expectedEvent =
  '9FA8207E-29E0-4203-8401-2775C20CB2F8:53BCA732-7729-4091-B401-4E6A870B098A';
export const expectedSymptom = 'symptom-36f42b052c1b26c6a1633c486b14d6a8';

let contextReady = false;
let generation = 0;
let observed = new Set<string>();
let report: (value: string) => void = () => undefined;
let lastRejection: RejectCode | null = null;
type RejectCode =
  | 'superseded'
  | 'context_missing'
  | 'context_mismatch'
  | 'inventory_unavailable'
  | 'inventory_mismatch'
  | 'provider_mismatch'
  | 'alias_invalid'
  | 'alias_unobserved'
  | 'payload_invalid'
  | 'evidence_mismatch'
  | 'aggregate_unconfirmed';

/** This opt-in fixture records only closed reason codes, never IDs, values or errors. */
export function rejectScope(token: number, code: RejectCode): never {
  requireGeneration(token);
  lastRejection = code;
  console.info(`OROT_SYNTHETIC_SCOPE_REJECT ${code}`);
  report(JSON.stringify({ scopeRejected: code }));
  throw new Error('Synthetic scope check rejected the request.');
}

/** Reset per generation; absence of the instrumented context blocks every provider call. */
export function beginScopeObservation(write: (value: string) => void) {
  generation += 1;
  contextReady = false;
  observed = new Set();
  lastRejection = null;
  report = write;
  return generation;
}
export function currentScopeGeneration() {
  return generation;
}
export function scopeRejection(token: number) {
  requireGeneration(token);
  return lastRejection;
}
function requireGeneration(token: number) {
  if (token !== generation) {
    // A late request must not overwrite the current run's result.
    console.info('OROT_SYNTHETIC_SCOPE_REJECT superseded');
    throw new Error('Synthetic scope check rejected the request.');
  }
}
export function acceptScopeContext(token: number) {
  requireGeneration(token);
  contextReady = true;
}
export function requireScopeContext(token: number) {
  requireGeneration(token);
  if (!contextReady) rejectScope(token, 'context_missing');
}
/** Do not invoke the real provider when the observed context or inventory fails. */
export async function dispatchScoped<T>(
  token: number,
  check: () => Promise<void>,
  send: () => Promise<T>,
): Promise<T> {
  requireScopeContext(token);
  await check();
  requireScopeContext(token);
  return send();
}
export function observedEvidenceCount(token: number) {
  requireGeneration(token);
  return observed.size;
}

/** Inspect only evidence aliases in the outgoing request; never emit the request or its content. */
export function providerEvidenceCount(
  token: number,
  request: LanguageModelRequest,
) {
  requireScopeContext(token);
  const aliases = new Set<string>();
  const accept = (value: unknown) => {
    if (typeof value !== 'string' || !/^evidence-[1-9][0-9]*$/u.test(value))
      rejectScope(token, 'alias_invalid');
    const index = Number(value.slice('evidence-'.length));
    if (index > observed.size) rejectScope(token, 'alias_unobserved');
    aliases.add(value);
  };
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'evidenceId') accept(entry);
      else if (key === 'evidenceIds') {
        if (!Array.isArray(entry)) rejectScope(token, 'payload_invalid');
        entry.forEach(accept);
      } else inspect(entry);
    }
  };
  for (const message of request.messages) {
    if (message.role === 'tool') inspect(message.result);
    if (message.role === 'user' && typeof message.content === 'string') {
      const line = message.content
        .split('\n')
        .find(value => value.startsWith('Available evidence: '));
      if (line) {
        let evidence: unknown;
        try {
          evidence = JSON.parse(line.slice('Available evidence: '.length));
        } catch {
          rejectScope(token, 'payload_invalid');
        }
        inspect(evidence);
      }
    }
  }
  return aliases.size;
}

/** Check each actual returned evidence item before the runtime can pass it to a model. */
export function acceptScopeEvidence(
  token: number,
  collection: VisitQuestionEvidenceCollection,
) {
  requireScopeContext(token);
  for (const item of collection.batch.items) {
    const metadata = collection.metadataByCitation.get(
      visitQuestionCitationKey(item),
    );
    const locator = item.locator;
    if (
      item.sourceKind !== 'personal_record' ||
      item.sourceId !== expectedSymptom ||
      item.evidenceId !== expectedSymptom ||
      !locator ||
      typeof locator !== 'object' ||
      Array.isArray(locator) ||
      !('kind' in locator) ||
      locator.kind !== 'structured_record' ||
      !('recordId' in locator) ||
      locator.recordId !== expectedSymptom ||
      metadata?.recordKind !== 'symptom_entry' ||
      metadata.evidenceRecordId !== expectedSymptom ||
      !metadata.sourceRecordIds.length ||
      metadata.sourceRecordIds.some(id => id !== expectedSymptom)
    )
      rejectScope(token, 'evidence_mismatch');
    observed.add(visitQuestionCitationKey(item));
  }
  report(
    JSON.stringify({ evidenceMatch: true, validatedEvidence: observed.size }),
  );
}

/** Aggregated period results have indirect provenance and are rejected unless separately proven. */
export function acceptEmptyHealthBatch(token: number, count: number) {
  requireScopeContext(token);
  if (count !== 0) rejectScope(token, 'aggregate_unconfirmed');
}
