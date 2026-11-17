import type { LocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import type { ProviderObservationSummary } from './providerObservationProjection';
import { LocalEvidenceIdentifiers } from './evidenceIdentifiers';

/** Provider-facing text uses ephemeral aliases even for IDs embedded in free text. */
export async function dailyReportProviderFacts(
  data: LocalEvidenceData,
  values: readonly LocalHealthEvidenceRecord[],
  facts: readonly {
    modelText: string;
    sensorSummary?: ProviderObservationSummary;
  }[],
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
    facts
      .map(fact =>
        fact.sensorSummary
          ? [fact.sensorSummary.concept, fact.sensorSummary.unit ?? ''].join(
              ' ',
            )
          : fact.modelText,
      )
      .join('\n'),
    signal,
  ))
    identifiers.register(id);
  if (signal.aborted) throw new Error('Daily report projection cancelled.');
  return facts.map(fact => ({
    // Numeric statistics and timestamps are typed data, not free text to scan for record IDs.
    // Redacting their JSON serialization could turn a value equal to an identifier into an alias.
    text: fact.sensorSummary
      ? JSON.stringify({
          ...fact.sensorSummary,
          concept: identifiers.redact(fact.sensorSummary.concept),
          unit:
            fact.sensorSummary.unit === null
              ? null
              : identifiers.redact(fact.sensorSummary.unit),
        })
      : identifiers.redact(fact.modelText),
  }));
}
