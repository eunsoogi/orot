import { LocalEvidenceIdentifiers } from './evidenceIdentifiers';
import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import type { ReviewState } from '@orot/domain';
import type { ChunkRecordType, EvidenceChunk } from '@orot/rag';
import { fingerprint } from './evidenceUtils';
import type { EvidenceSourceReadResult } from './evidenceSourceDocument';
export type {
  EvidenceSourceDocument,
  EvidenceSourceReadResult,
} from './evidenceSourceDocument';

export interface EvidenceValidationContext {
  once<T>(key: object, load: () => Promise<T>): Promise<T>;
}

type ReferenceValidator = (
  signal: AbortSignal,
  context: EvidenceValidationContext,
) => Promise<boolean>;

type SourceReader = (signal: AbortSignal) => Promise<EvidenceSourceReadResult>;

interface RegistryEntry {
  readonly original: EvidenceReference;
  readonly validate: ReferenceValidator;
  readonly readSource: SourceReader;
}

function validationContext(): EvidenceValidationContext {
  const loads = new Map<object, Promise<unknown>>();
  return {
    once<T>(key: object, load: () => Promise<T>): Promise<T> {
      let result = loads.get(key) as Promise<T> | undefined;
      if (!result) {
        result = Promise.resolve().then(load);
        loads.set(key, result);
      }
      return result;
    },
  };
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(',')}}`;
}

function stableReference(reference: EvidenceReference): string {
  return stable({
    sourceKind: reference.sourceKind,
    sourceId: reference.sourceId,
    sourceRevision: reference.sourceRevision,
    evidenceId: reference.evidenceId,
    evidenceRevision: reference.evidenceRevision,
    locator: reference.locator,
    effectiveTime: reference.effectiveTime,
    ...(reference.unit === undefined ? {} : { unit: reference.unit }),
    reviewState: reference.reviewState,
  });
}

/** Keeps raw local identifiers behind a turn-local citation that can be revalidated before use. */
export class LocalEvidenceReferenceRegistry {
  private nextAlias = 0;
  private readonly searchChunks = new WeakMap<EvidenceChunk, EvidenceChunk>();
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly identifiers = new LocalEvidenceIdentifiers();

  /** Resolves a provider scope locally before any database candidates are selected. */
  localSourceIds(aliases: readonly string[]): readonly string[] {
    return this.identifiers.localSources(aliases);
  }

  registerSensitiveIdentifier(value: string): string {
    return this.identifiers.register(value);
  }

  add(input: {
    readonly reference: EvidenceReference;
    readonly content: string;
    readonly validate: ReferenceValidator;
    readonly readSource: SourceReader;
  }): EvidenceItem {
    this.registerSensitiveIdentifier(input.reference.sourceId);
    this.registerSensitiveIdentifier(input.reference.evidenceId);
    const alias = ++this.nextAlias;
    const token = `e${alias}`;
    // A supplemental search retains source scope even when it registers another row from that source.
    const sourceAlias = this.identifiers.sourceAlias(
      input.reference.sourceId,
      `s${alias}`,
    );
    const reference: EvidenceReference = {
      ...input.reference,
      sourceId: sourceAlias,
      sourceRevision: `sr${alias}`,
      evidenceId: token,
      evidenceRevision: `er${alias}`,
      locator: { kind: 'local-evidence', token },
    };
    this.entries.set(stable(reference), {
      original: { ...input.reference },
      validate: input.validate,
      readSource: input.readSource,
    });
    return { ...reference, content: this.redactText(input.content) };
  }

  redactText(value: string): string {
    return this.identifiers.redact(value);
  }

  toSearchChunk(
    item: EvidenceItem,
    text: string,
    reviewState: ReviewState,
    recordType: ChunkRecordType = 'evidence_span',
    persistedId?: string,
    persisted?: EvidenceChunk,
  ): EvidenceChunk {
    const safeText = this.redactText(text);
    // Hash stable local identity so fresh snapshots reuse vectors without exposing record IDs.
    const original = this.resolve(item);
    const id =
      persistedId ??
      `local-chunk-${fingerprint({
        recordType,
        sourceKind: original?.sourceKind ?? item.sourceKind,
        sourceId: original?.sourceId ?? item.sourceId,
        evidenceId: original?.evidenceId ?? item.evidenceId,
      })}`;
    const chunk: EvidenceChunk = {
      id,
      text: safeText,
      metadata: {
        sourceId: item.sourceId,
        sourceRecordIds: [item.sourceId],
        evidenceId: item.evidenceId,
        evidenceLocator: {
          kind: 'text_range',
          startOffset: 0,
          endOffset: safeText.length,
        },
        effectiveTime: item.effectiveTime,
        recordType,
        reviewState,
      },
    };
    if (!original) throw new Error('Search evidence must be registered.');
    const locator = original.locator;
    const sourceIds =
      locator && typeof locator === 'object' && !Array.isArray(locator)
        ? (locator as { readonly sourceIds?: unknown }).sourceIds
        : undefined;
    this.searchChunks.set(
      chunk,
      persisted ?? {
        ...chunk,
        metadata: {
          ...chunk.metadata,
          sourceId: original.sourceId,
          evidenceId: original.evidenceId,
          sourceRecordIds: Array.isArray(sourceIds)
            ? sourceIds.filter(
                (value): value is string => typeof value === 'string',
              )
            : [original.sourceId],
          evidenceLocator:
            original.sourceKind === 'reviewed_memory'
              ? chunk.metadata.evidenceLocator
              : { kind: 'structured_record', recordId: original.evidenceId },
        },
      },
    );
    return chunk;
  }

  /** Only the local encrypted index receives storage identities; provider references stay opaque. */
  localSearchChunk(chunk: EvidenceChunk): EvidenceChunk {
    const local = this.searchChunks.get(chunk);
    if (!local)
      throw new Error('Search chunk is outside the current registry.');
    return local;
  }

  resolve(reference: EvidenceReference): EvidenceReference | undefined {
    const entry = this.entries.get(stableReference(reference));
    return entry ? { ...entry.original } : undefined;
  }

  /** Reads a clicked citation only while its saved row and derived chunk still match. */
  async readSource(
    reference: EvidenceReference,
    signal: AbortSignal,
  ): Promise<EvidenceSourceReadResult> {
    const entry = this.entries.get(stableReference(reference));
    if (!entry || signal.aborted) return { status: 'unavailable' };
    try {
      const current = await entry.readSource(signal);
      if (current.status !== 'available') return current;
      if (signal.aborted) return { status: 'unavailable' };
      if (!(await entry.validate(signal, validationContext()))) {
        const latest = await entry.readSource(signal);
        return latest.status === 'missing' || latest.status === 'unavailable'
          ? latest
          : { status: 'changed' };
      }
      return current;
    } catch {
      return { status: 'unavailable' };
    }
  }

  async revalidateEvidence(
    references: readonly EvidenceReference[],
    signal: AbortSignal,
  ): Promise<boolean> {
    if (references.length === 0) return false;
    const context = validationContext();
    for (const reference of references) {
      const entry = this.entries.get(stableReference(reference));
      if (!entry || signal.aborted) return false;
      try {
        if (!(await entry.validate(signal, context)) || signal.aborted)
          return false;
      } catch {
        return false;
      }
    }
    return true;
  }
}
