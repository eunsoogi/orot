import type { MemoryRecord, StorageAdapter } from 'rememori';

export type AgentMemoryKind = 'preference' | 'reviewed_interaction' | 'task_context';
export type AgentMemoryReviewState = 'user_confirmed' | 'human_reviewed' | 'user_stated';

export interface AgentMemorySourceDate {
  readonly sourceId: string;
  readonly date: string;
}

export interface AgentMemoryProvenance {
  readonly sourceIds: readonly string[];
  /** Typed identities disambiguate records that share a raw local identifier. */
  readonly sourceReferences?: readonly { readonly kind: string; readonly id: string }[];
  readonly sourceDates?: readonly AgentMemorySourceDate[];
  readonly reviewState: AgentMemoryReviewState;
}

export interface AgentMemoryInput {
  /** Stable caller-owned key used to make create and correction retries idempotent. */
  readonly memoryKey: string;
  readonly text: string;
  readonly kind: AgentMemoryKind;
  readonly provenance: AgentMemoryProvenance;
  readonly importance?: number;
}

export interface AgentMemoryDraft {
  readonly memoryKey: string;
  readonly text: string;
  readonly kind: AgentMemoryKind;
  readonly importance?: number;
}

export interface AgentMemoryAuthorization {
  readonly provenance: AgentMemoryProvenance;
}

export interface AgentMemoryToolPolicy {
  authorizeWrite(draft: AgentMemoryDraft): Promise<AgentMemoryAuthorization | null>;
  authorizeDelete(memoryId: string): Promise<boolean>;
}

export interface AgentMemoryHit {
  /** Service results include this durable key; optional for existing caller-constructed hits. */
  readonly memoryKey?: string;
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly kind: AgentMemoryKind;
  readonly provenance: AgentMemoryProvenance;
  readonly createdAt: number;
}

export interface PersistedMemoryRecord extends MemoryRecord {}

/** Source-scoped app request; these IDs are candidates, not deletion authority. */
export type SourceCascadeBatchPhase =
  | 'batch-admission'
  | 'batch-state-read'
  | 'batch-record-writes'
  | 'batch-fence-writes'
  | 'batch-settlement';

export type SourceCascadeBatchObserver = (
  phase: SourceCascadeBatchPhase,
  event: 'begin' | 'success' | 'failure',
) => void;

export interface AgentMemorySourceCascade {
  readonly references: ReadonlySet<string>;
  readonly typedReferences?: readonly { id: string; kind: string }[];
  readonly candidateIds: readonly string[];
  readonly observe?: SourceCascadeBatchObserver;
}

/** Rememori's storage contract plus the atomic operations needed by app corrections. */
export interface AgentMemoryStorageAdapter extends StorageAdapter {
  listRecords(): Promise<PersistedMemoryRecord[]>;
  /** Explicit global deletion must include rows hidden from normal evidence reads. */
  listAllRecordsForPurge?(): Promise<PersistedMemoryRecord[]>;
  listRemovedSourceIds(): Promise<string[]>;
  listInvalidatedSourceIds(): Promise<string[]>;
  /** Changes when typed quarantine fences change, without conflating them with raw IDs. */
  listQuarantineRevision?(): Promise<string>;
  markSourceRemoved(sourceId: string, kinds?: readonly string[]): Promise<void>;
  beginBatch(): void;
  /** The owning adapter rechecks current scope, applies fences atomically and returns committed Memory IDs. */
  commitSourceCascade?(
    intent: AgentMemorySourceCascade,
    namespaceIdentity?: string,
  ): Promise<readonly string[]>;
  /** An optional app-private witness is consumed only by the same write batch. */
  commitBatch(witness?: { readonly recordId: string; readonly context: unknown }): Promise<void>;
  rollbackBatch(): void;
}
