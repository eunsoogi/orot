import type { EvidenceItem } from '@orot/agent-runtime';
import {
  conflictingOverviewRows,
  overviewRow,
  type OverviewRow,
} from './summaryOverviewConcepts';

/** Collect recognizable competing rows even when their source cannot use row selection. */
export function additionalOverviewConflictSources(
  items: readonly EvidenceItem[],
  eligible: readonly { item: EvidenceItem }[],
): { item: EvidenceItem; rows: OverviewRow[] }[] {
  return items.flatMap(item => {
    if (
      item.sourceKind !== 'personal_record' ||
      eligible.some(source => source.item.evidenceId === item.evidenceId)
    )
      return [];
    const overview = item.content.startsWith('health_overview: ');
    const record = item.content.startsWith('health_observation: ');
    if (!overview && !record) return [];
    try {
      const parsed: unknown = JSON.parse(
        item.content
          .split('\n')[0]!
          .slice(
            overview
              ? 'health_overview: '.length
              : 'health_observation: '.length,
          ),
      );
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return [];
      const data = parsed as Record<string, unknown>;
      const values = overview ? data.records : [data];
      if (!Array.isArray(values) || values.length > 32) return [];
      const rows = values.flatMap(value => {
        if (
          overview &&
          (!value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            (value as Record<string, unknown>).kind !== 'health_observation')
        )
          return [];
        const row = overviewRow(value, record ? item.effectiveTime : undefined);
        return row ? [row] : [];
      });
      return rows.length ? [{ item, rows }] : [];
    } catch {
      return [];
    }
  });
}

/** Preserve all readings for one conflicting concept and instant, or suppress that conflict set. */
export function filterOverviewConflicts(
  sources: readonly { item: EvidenceItem; rows: readonly OverviewRow[] }[],
  selected: Map<string, number[]>,
) {
  const flattened = sources.flatMap(source =>
    source.rows.map((row, index) => ({ source, row, index })),
  );
  const conflicts = conflictingOverviewRows(flattened.map(entry => entry.row));
  const disclosed = new Set<string>();
  const suppressed = new Set<string>();
  let omitted = false;
  for (const index of conflicts) {
    const current = flattened[index]!;
    const group = [...conflicts]
      .map(other => flattened[other]!)
      .filter(
        other =>
          other.row.label === current.row.label &&
          other.row.time &&
          current.row.time &&
          Date.parse(other.row.time) === Date.parse(current.row.time),
      );
    if (
      group.some(
        entry =>
          !selected.get(entry.source.item.evidenceId)?.includes(entry.index),
      )
    ) {
      for (const entry of group) {
        const id = entry.source.item.evidenceId;
        suppressed.add(id);
        const original = selected.get(id) ?? [];
        const remaining = original.filter(row => row !== entry.index);
        if (remaining.length !== original.length) omitted = true;
        if (remaining.length) selected.set(id, remaining);
        else selected.delete(id);
      }
    } else {
      for (const entry of group) disclosed.add(entry.source.item.evidenceId);
    }
  }
  return { disclosed, suppressed, omitted };
}
