import type { EvidenceReference } from '@orot/agent-runtime';
import {
  LocalEvidenceIdentifiers,
  type EvidenceIdentifierSnapshot,
} from './evidenceIdentifiers';
import type { RegistryEntry } from './evidenceRegistry';
import { stableEvidenceReference, stable } from './stableEvidenceReference';

/** Raw source identities belong only in protected storage, never graph channels or provider input.
 * This is alias plumbing, not authority to resume a workflow or validate a source. */
export interface EvidenceRegistrySnapshot {
  readonly version: 1;
  readonly nextAlias: number;
  readonly identifiers: EvidenceIdentifierSnapshot;
  readonly entries: readonly {
    readonly alias: EvidenceReference;
    readonly original: EvidenceReference;
  }[];
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function captureRegistry(
  entries: ReadonlyMap<string, RegistryEntry>,
  identifiers: EvidenceIdentifierSnapshot,
  nextAlias: number,
): EvidenceRegistrySnapshot {
  return copy({
    version: 1,
    nextAlias,
    identifiers,
    entries: [...entries.values()].map(({ alias, original }) => ({
      alias,
      original,
    })),
  });
}

/** Construct a complete isolated plan before mutating any registry; no reader is invoked. */
export function restoreRegistry(
  snapshot: EvidenceRegistrySnapshot,
  fresh: ReadonlyMap<string, RegistryEntry>,
) {
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    !Number.isSafeInteger(snapshot.nextAlias) ||
    snapshot.nextAlias < 0 ||
    !Array.isArray(snapshot.entries) ||
    snapshot.entries.length !== snapshot.nextAlias
  )
    throw new Error('Invalid private evidence registry snapshot.');
  const saved = copy(snapshot);
  const identifiers = LocalEvidenceIdentifiers.restore(saved.identifiers);
  const sourceMappings = new Map(saved.identifiers.sources);
  const redactions = new Map(saved.identifiers.sensitive);
  const seen = new Set<number>();
  const entries: [EvidenceReference, RegistryEntry][] = [];
  for (const row of saved.entries) {
    if (!row || !row.alias || !row.original)
      throw new Error('Invalid saved evidence entry.');
    const { alias, original } = row;
    const index = Number(/^e([1-9][0-9]*)$/.exec(alias.evidenceId)?.[1]);
    if (
      !Number.isSafeInteger(index) ||
      index > saved.nextAlias ||
      seen.has(index)
    )
      throw new Error('Conflicting evidence alias.');
    seen.add(index);
    if (
      alias.evidenceRevision !== `er${index}` ||
      alias.sourceRevision !== `sr${index}` ||
      stable(alias.locator) !==
        stable({ kind: 'local-evidence', token: alias.evidenceId }) ||
      sourceMappings.get(alias.sourceId) !== original.sourceId ||
      !redactions.has(original.evidenceId)
    )
      throw new Error('Invalid evidence alias binding.');
    const projected = {
      ...original,
      sourceId: alias.sourceId,
      sourceRevision: alias.sourceRevision,
      evidenceId: alias.evidenceId,
      evidenceRevision: alias.evidenceRevision,
      locator: alias.locator,
    };
    if (stable(projected) !== stable(alias))
      throw new Error('Changed evidence projection.');
    // Full JSON equality, not a compact fingerprint, binds readers to the exact original.
    const matches = [...fresh.values()].filter(
      entry => stable(copy(entry.original)) === stable(original),
    );
    if (matches.length !== 1)
      throw new Error('Exact fresh source reader unavailable or ambiguous.');
    const entry = matches[0];
    entries.push([
      alias,
      {
        alias,
        original,
        validate: entry.validate,
        readSource: entry.readSource,
      },
    ]);
  }
  if (
    new Set(entries.map(([alias]) => stableEvidenceReference(alias))).size !==
    entries.length
  )
    throw new Error('Duplicate evidence reference.');
  for (const [alias] of sourceMappings) {
    if (
      Number(alias.slice(1)) > saved.nextAlias ||
      !entries.some(([ref]) => ref.sourceId === alias)
    )
      throw new Error('Unbound source alias.');
  }
  return { identifiers, entries };
}
