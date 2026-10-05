import type { MemoryRecord, StorageAdapter } from 'rememori';

export type AgentMemoryKind = 'preference' | 'reviewed_interaction' | 'task_context';
export type AgentMemoryReviewState = 'user_confirmed' | 'human_reviewed';

export interface AgentMemorySourceDate {
  readonly sourceId: string;
  readonly date: string;
}

export interface AgentMemoryProvenance {
  readonly sourceIds: readonly string[];
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
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly kind: AgentMemoryKind;
  readonly provenance: AgentMemoryProvenance;
  readonly createdAt: number;
}

export interface PersistedMemoryRecord extends MemoryRecord {}

/** Rememori's storage contract plus the atomic operations needed by app corrections. */
export interface AgentMemoryStorageAdapter extends StorageAdapter {
  listRecords(): Promise<PersistedMemoryRecord[]>;
  listRemovedSourceIds(): Promise<string[]>;
  listInvalidatedSourceIds(): Promise<string[]>;
  markSourceRemoved(sourceId: string): Promise<void>;
  beginBatch(): void;
  commitBatch(): Promise<void>;
  rollbackBatch(): void;
}
