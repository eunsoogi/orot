import type { EvidenceItem } from '@orot/agent-runtime';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import {
  isBulkSensorObservation,
  summarizeProviderObservations,
} from './providerObservationProjection';
import {
  providerRecordFacts,
  providerJsonContent,
} from './providerObservationEvidence';
import { presentEvidenceSource } from './evidenceSourcePresentation';

/** Protected checkpoints preserve exact bytes, not permanent permission to replay
 * raw sensor samples. Recompute current allowed projections without rewriting a
 * signed request; incompatible old requests must restart under current policy. */
export async function validateColdObservationPolicy(
  items: readonly EvidenceItem[],
  registry: LocalEvidenceReferenceRegistry,
  signal: AbortSignal,
): Promise<void> {
  for (const item of items) {
    if (signal.aborted) throw new Error('Cold sensor validation cancelled.');
    if (item.sourceKind !== 'personal_record') continue;
    const source = await registry.readSource(item, signal);
    if (signal.aborted) throw new Error('Cold sensor validation cancelled.');
    if (source.status !== 'available')
      throw new Error('Cold source is unavailable.');
    if (source.document.sourceKind !== 'personal_record') continue;
    // Original-source views can include linked sensor rows even when the chosen
    // primary record is narrative. Inspect the complete local document first.
    if (!source.document.records.some(isBulkSensorObservation)) continue;
    const original = registry.resolve(item);
    const locator = original?.locator as
      { references?: { evidenceId: string }[] } | undefined;
    const memberIds = new Set(
      locator?.references?.map(reference => reference.evidenceId) ??
        (original ? [original.evidenceId] : []),
    );
    const selected = source.document.records.filter(record =>
      memberIds.has(record.record.id),
    );
    // Source documents also contain local provenance dependencies. They are not
    // extra members of the provider-visible statistic.
    const records =
      locator?.references && selected.length
        ? selected
        : source.document.records;
    const summaries = summarizeProviderObservations(records).map(
      group => group.content,
    );
    // Group ordinals are turn-local presentation labels, not measurements. A
    // restored member group can be numbered differently when read in isolation.
    // Retain only its protected numeric ordinal after checking the fixed label prefix.
    if (
      item.content.startsWith('sensor_period_summary: ') &&
      summaries.length === 1
    ) {
      try {
        const saved = JSON.parse(
          item.content.slice('sensor_period_summary: '.length),
        );
        const label = saved.sourceLabel;
        const prefix = summaries[0]!.sourceLabel.replace(/group_\d+$/, '');
        const expected = registry.redactText(prefix);
        if (
          typeof label === 'string' &&
          label.startsWith(expected) &&
          /^group_[1-9]\d*$/.test(label.slice(expected.length))
        )
          summaries[0] = {
            ...summaries[0]!,
            sourceLabel: prefix + label.slice(expected.length),
          };
      } catch {
        /* Invalid protected content remains ineligible below. */
      }
    }
    const safe = new Set<string>(
      summaries.map(summary =>
        providerJsonContent(registry, summary, 'sensor_period_summary: '),
      ),
    );
    const facts = providerRecordFacts(records);
    let overview: Record<string, unknown> | undefined;
    try {
      if (item.content.startsWith('health_overview: '))
        overview = JSON.parse(item.content.slice('health_overview: '.length));
    } catch {
      /* A malformed checkpoint cannot receive a projection exemption. */
    }
    if (
      overview &&
      (overview.topic === undefined ||
        [
          'measurements',
          'activity',
          'sleep',
          'medications',
          'symptoms',
          'sensor_summary',
        ].includes(String(overview.topic))) &&
      (overview.selection === undefined ||
        overview.selection === 'bounded_recent_samples_not_exhaustive') &&
      Object.keys(overview).every(key =>
        ['topic', 'selection', 'records', 'sensorSummaries'].includes(key),
      )
    ) {
      const projected = {
        ...(overview.topic === undefined ? {} : { topic: overview.topic }),
        ...(overview.selection === undefined
          ? {}
          : { selection: overview.selection }),
        ...facts,
      };
      safe.add(providerJsonContent(registry, projected, 'health_overview: '));
    }
    safe.add(
      providerJsonContent(registry, {
        source: presentEvidenceSource({
          ...source.document,
          records: records.filter(row => !isBulkSensorObservation(row)),
        }),
        sensorSummaries: summaries,
      }),
    );
    if (!safe.has(item.content))
      throw new Error(
        'Cold sensor evidence requires a new locally summarized request.',
      );
  }
}
