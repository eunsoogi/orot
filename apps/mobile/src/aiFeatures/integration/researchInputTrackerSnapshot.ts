import type { EvidenceReference } from '@orot/agent-runtime';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { stableJson } from './evidenceUtils';

/** Protected DB only: raw source identities are not graph/provider payloads or reusable consent.
 * Call-scoped ToolReferenceIndex bindings require a separate snapshot; this format cannot grant them. */
export interface ResearchInputTrackerSnapshot {
  readonly version: 1;
  readonly incomplete: boolean;
  readonly scopeBindings: 'not_captured';
  readonly inputs: readonly {
    readonly reference: EvidenceReference;
    readonly original: EvidenceReference;
  }[];
  readonly retained: readonly {
    readonly id: string;
    readonly revision: string;
    readonly reference: EvidenceReference;
  }[];
}

export function snapshotResearchInputs(
  registry: LocalEvidenceReferenceRegistry,
  inputs: ReadonlyMap<string, EvidenceReference>,
  retained: ReadonlyMap<string, EvidenceReference>,
  incomplete: boolean,
): ResearchInputTrackerSnapshot {
  const snapshot: ResearchInputTrackerSnapshot = {
    version: 1,
    incomplete,
    scopeBindings: 'not_captured',
    inputs: [...inputs.values()].map(reference => {
      const original = registry.resolve(reference);
      if (!original) throw new Error('Research input original unavailable.');
      return { reference, original };
    }),
    retained: [...retained].map(([key, reference]) => {
      const [id, revision] = JSON.parse(key);
      return { id, revision, reference };
    }),
  };
  // Apply the same structural/provenance checks on capture, without executing readers.
  restoreResearchInputs(snapshot, registry);
  return JSON.parse(JSON.stringify(snapshot));
}

/** Exact fresh aliases bind local readers, but their freshness is still checked by the caller/runtime. */
export function restoreResearchInputs(
  value: ResearchInputTrackerSnapshot,
  registry: LocalEvidenceReferenceRegistry,
) {
  if (
    !value ||
    value.version !== 1 ||
    typeof value.incomplete !== 'boolean' ||
    value.scopeBindings !== 'not_captured' ||
    !Array.isArray(value.inputs) ||
    !Array.isArray(value.retained)
  )
    throw new Error('Invalid protected research input snapshot.');
  const snapshot: ResearchInputTrackerSnapshot = JSON.parse(
    JSON.stringify(value),
  );
  const inputs = new Map<string, EvidenceReference>();
  const originals = new Map<string, EvidenceReference>();
  for (const row of snapshot.inputs) {
    const original = row?.reference && registry.resolve(row.reference);
    const key = stableJson(row?.reference);
    if (
      !row?.original ||
      !original ||
      stableJson(original) !== stableJson(row.original) ||
      inputs.has(key)
    )
      throw new Error('Missing or conflicting research input original.');
    inputs.set(key, row.reference);
    originals.set(key, original);
  }
  const retained = new Map<string, EvidenceReference>();
  const retainedAliases = new Set<string>();
  for (const row of snapshot.retained) {
    const alias = stableJson(row?.reference);
    const original = originals.get(alias);
    const key = stableJson([row?.id, row?.revision]);
    const locator = original?.locator as
      { kind?: unknown; type?: unknown } | undefined;
    if (
      !row ||
      typeof row.id !== 'string' ||
      !/^research-[1-9][0-9]*$/.test(row.id) ||
      typeof row.revision !== 'string' ||
      !row.revision ||
      !original ||
      original.sourceKind !== 'generated_artifact' ||
      original.sourceId !== row.id ||
      original.evidenceId !== row.id ||
      original.sourceRevision !== row.revision ||
      original.evidenceRevision !== row.revision ||
      locator?.kind !== 'generated_artifact' ||
      !['research_publication', 'research_web_explanation'].includes(
        String(locator.type),
      ) ||
      retained.has(key) ||
      retainedAliases.has(alias)
    )
      throw new Error('Missing or conflicting retained research identity.');
    retained.set(key, row.reference);
    retainedAliases.add(alias);
  }
  return { inputs, retained, incomplete: snapshot.incomplete };
}
