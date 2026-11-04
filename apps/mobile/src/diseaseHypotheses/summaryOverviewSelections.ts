import type { EvidenceItem, TaskResponderInput } from '@orot/agent-runtime';
import type { JsonValue } from '@orot/model-runtime';
import { overviewRow, type OverviewRow } from './summaryOverviewConcepts';
import {
  filterOverviewConflicts,
  additionalOverviewConflictSources,
} from './summaryOverviewConflicts';

type Source = {
  readonly item: EvidenceItem;
  readonly topic: string;
  readonly rows: readonly OverviewRow[];
};
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Enumerate recognized quantity groups independently of other personal evidence. */
export function overviewSelectionSources(
  input?: TaskResponderInput,
): readonly Source[] | undefined {
  const personal =
    input?.evidence.items.filter(
      item => item.sourceKind === 'personal_record',
    ) ?? [];
  if (
    !personal.length ||
    personal.length > 8 ||
    new Set(input!.evidence.items.map(item => item.evidenceId)).size !==
      input!.evidence.items.length
  )
    return;
  const sources: Source[] = [];
  const parseSource = (item: EvidenceItem): Source | undefined => {
    if (!item.content.startsWith('health_overview: ')) return;
    let value: unknown;
    try {
      value = JSON.parse(item.content.slice('health_overview: '.length));
    } catch {
      return;
    }
    if (
      !object(value) ||
      !['measurements', 'activity'].includes(String(value.topic)) ||
      !Array.isArray(value.records) ||
      !value.records.length ||
      value.records.length > 32
    )
      return;
    const rows: OverviewRow[] = [];
    for (const raw of value.records) {
      if (!object(raw) || raw.kind !== 'health_observation') return;
      const row = overviewRow(raw);
      if (!row) return;
      rows.push(row);
    }
    return { item, topic: String(value.topic), rows };
  };
  for (const item of personal) {
    const source = parseSource(item);
    if (source) sources.push(source);
  }
  return sources.length ? sources : undefined;
}

/** Bind selected rows to their original source identity; never copy generated prose into record facts. */
export function resolveOverviewSelections(
  value: Record<string, JsonValue>,
  input: TaskResponderInput,
) {
  const sources = overviewSelectionSources(input);
  if (
    Object.keys(value).some(
      key => !['recordSelections', 'sections', 'coverageNotes'].includes(key),
    )
  )
    return;
  const otherSections = value.sections === undefined ? [] : value.sections;
  if (
    !Array.isArray(otherSections) ||
    otherSections.some(section => {
      if (
        !object(section) ||
        !Array.isArray(section.supportingEvidence) ||
        !section.supportingEvidence.length
      )
        return true;
      return section.supportingEvidence.some(
        id =>
          typeof id !== 'string' ||
          input.evidence.items.filter(
            item =>
              item.evidenceId === id &&
              !sources?.some(source => source.item.evidenceId === id),
          ).length !== 1,
      );
    })
  )
    return;
  if (
    !sources ||
    !Array.isArray(value.recordSelections) ||
    !value.recordSelections.length ||
    value.recordSelections.length > sources.length
  )
    return;
  const selected = new Map<string, number[]>();
  const subsetLimit = new Set<string>();
  const seen = new Set<string>();
  let omitted = false;
  for (const entry of value.recordSelections) {
    if (
      !object(entry) ||
      Object.keys(entry).some(
        key => !['sourceId', 'rows', 'limitationCodes'].includes(key),
      ) ||
      typeof entry.sourceId !== 'string' ||
      !Array.isArray(entry.rows) ||
      !entry.rows.length ||
      (entry.limitationCodes !== undefined &&
        (!Array.isArray(entry.limitationCodes) ||
          entry.limitationCodes.length > 1 ||
          entry.limitationCodes.some(code => code !== 'subset_only')))
    )
      return;
    const source = sources.find(
      candidate => candidate.item.evidenceId === entry.sourceId,
    );
    if (!source || seen.has(entry.sourceId) || entry.rows.length > 32) return;
    seen.add(entry.sourceId);
    if (
      Array.isArray(entry.limitationCodes) &&
      entry.limitationCodes.includes('subset_only')
    )
      subsetLimit.add(entry.sourceId);
    const indices: number[] = [];
    for (const key of entry.rows) {
      const index =
        typeof key === 'string' && /^r(?:0|[1-9]\d*)$/u.test(key)
          ? Number(key.slice(1))
          : -1;
      if (index < 0 || index >= source.rows.length || indices.includes(index)) {
        omitted = true;
        continue;
      }
      indices.push(index);
    }
    if (indices.length) selected.set(entry.sourceId, indices);
    else omitted = true;
  }
  const conflicts = filterOverviewConflicts(
    [
      ...sources,
      ...additionalOverviewConflictSources(input.evidence.items, sources),
    ],
    selected,
  );
  const safeSections = otherSections.filter(section => {
    if (!object(section)) return false;
    return !['supportingEvidence', 'contraryEvidence'].some(
      key =>
        Array.isArray(section[key]) &&
        section[key].some(
          (id: unknown) =>
            typeof id === 'string' && conflicts.suppressed.has(id),
        ),
    );
  });
  if (safeSections.length !== otherSections.length) omitted = true;
  omitted ||= conflicts.omitted;
  if (!selected.size && !safeSections.length) return;
  const sections: JsonValue[] = [];
  const items = input.evidence.items.map(item => {
    const source = sources.find(
      candidate => candidate.item.evidenceId === item.evidenceId,
    );
    if (!source) return item;
    const indices = selected.get(item.evidenceId) ?? [];
    if (indices.length !== source.rows.length) omitted = true;
    if (!indices.length) return item;
    const rows = indices.map(index => source.rows[index]!);
    sections.push({
      title: '측정 기록',
      summary: rows
        .map(
          row =>
            `${row.label}: ${row.amount} ${row.unit}${row.time ? ` · 기록 시각 ${row.time}` : ''}.`,
        )
        .join('\n'),
      supportingEvidence: [item.evidenceId],
      contraryEvidence: [],
      uncertainty: [
        ...(subsetLimit.has(item.evidenceId)
          ? ['조회한 기록에 한정돼요.']
          : []),
        ...(conflicts.disclosed.has(item.evidenceId)
          ? ['같은 시각에 서로 다른 측정값이 기록되어 있어요.']
          : []),
      ].join('\n'),
      missingData: [],
    });
    return {
      ...item,
      content:
        'health_overview: ' +
        JSON.stringify({
          topic: source.topic,
          records: rows.map(row => row.raw),
        }),
    };
  });
  return {
    sections: [...sections, ...safeSections],
    input: { ...input, evidence: { ...input.evidence, items } },
    omitted,
  };
}
