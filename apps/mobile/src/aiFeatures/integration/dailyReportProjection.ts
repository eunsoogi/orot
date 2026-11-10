import type { LocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import { LocalEvidenceIdentifiers } from './evidenceIdentifiers';

/** Provider-facing text uses ephemeral aliases even for IDs embedded in free text. */
export async function dailyReportProviderFacts(
  data: LocalEvidenceData,
  values: readonly LocalHealthEvidenceRecord[],
  facts: readonly { modelText: string }[],
  signal: AbortSignal,
) {
  const identifiers = new LocalEvidenceIdentifiers();
  for (const value of values) {
    identifiers.register(value.record.id);
    for (const id of value.record.provenance.sourceRecordIds)
      identifiers.register(id);
    const sourceId = value.record.provenance.source?.sourceIdentifier;
    if (sourceId) identifiers.register(sourceId);
  }
  for (const id of await data.findIdentifiers(
    facts.map(fact => fact.modelText).join('\n'),
    signal,
  ))
    identifiers.register(id);
  if (signal.aborted) throw new Error('Daily report projection cancelled.');
  return facts.map(fact => ({ text: identifiers.redact(fact.modelText) }));
}
