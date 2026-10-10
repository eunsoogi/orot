import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import type { ReviewState } from '@orot/domain';
import type { ChunkRecordType, EvidenceChunk } from '@orot/rag';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import { fingerprint } from './evidenceUtils';

export interface EvidenceValidationContext {
  once<T>(key: object, load: () => Promise<T>): Promise<T>;
}

type ReferenceValidator = (
  signal: AbortSignal,
  context: EvidenceValidationContext,
) => Promise<boolean>;

export type EvidenceSourceDocument =
  | {
      readonly sourceKind: 'personal_record';
      readonly records: readonly LocalHealthEvidenceRecord[];
    }
  | {
      readonly sourceKind: 'reviewed_memory';
      readonly record: PersistedMemoryRecord;
    };

export type EvidenceSourceReadResult =
  | { readonly status: 'available'; readonly document: EvidenceSourceDocument }
  | { readonly status: 'missing' | 'changed' | 'unavailable' };

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
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly sensitiveIds = new Map<string, string>();

  registerSensitiveIdentifier(value: string): string {
    if (!value) return '';
    const existing = this.sensitiveIds.get(value);
    if (existing) return existing;
    const alias = `local-id-${this.sensitiveIds.size + 1}`;
    this.sensitiveIds.set(value, alias);
    return alias;
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
    const reference: EvidenceReference = {
      ...input.reference,
      sourceId: `s${alias}`,
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
    return [...this.sensitiveIds.entries()]
      .sort(([left], [right]) => right.length - left.length)
      .reduce(
        (text, [identifier, alias]) => text.split(identifier).join(alias),
        value,
      );
  }

  toSearchChunk(
    item: EvidenceItem,
    text: string,
    reviewState: ReviewState,
    recordType: ChunkRecordType = 'evidence_span',
    persistedId?: string,
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
    return {
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
