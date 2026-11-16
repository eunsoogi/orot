import type { LanguageModelRequest } from '@orot/model-runtime';
import type { EvidenceReference } from './evidenceContracts';

/** Exact private input and results belong only in the caller's protected store, not graph channels. */
export interface WorkflowOperationIdentity {
  /** Internal read-only classifier only; never a tool or task execution exemption. */
  readonly purpose?: 'preview_review';
  readonly operationId: string;
  readonly input: string;
  readonly evidenceReferences: readonly EvidenceReference[];
}

export type WorkflowOperationRecord =
  | { readonly status: 'ready'; readonly revision: number }
  | { readonly status: 'pending' }
  | { readonly status: 'completed'; readonly result: string }
  | { readonly status: 'invalidated' };

/**
 * A request-scoped journal. Implementations fence every operation with current request/session
 * identity and source revisions. Pending work is never taken over: its remote outcome is unknown.
 * Authorization decisions are deliberately absent and must not be stored with these records.
 */
export interface WorkflowSteeringStore {
  subscribe?(listener: () => Promise<void>): () => void;
  enqueue(id: string, text: string): Promise<boolean>;
  /** Persist an at-most-once live submission before sending; uncertainty must not replay it. */
  beginLive?(operationId: string, id: string): Promise<boolean>;
  settleLive?(
    operationId: string,
    id: string,
    status: 'accepted' | 'applied' | 'pending' | 'failed',
  ): Promise<boolean>;
  list(): Promise<
    readonly {
      readonly id: string;
      readonly text: string;
      readonly sequence: number;
      readonly status: 'queued' | 'prepared' | 'applied' | 'not_applied' | 'delivery_pending';
    }[]
  >;
  bind(
    operationId: string,
    request: LanguageModelRequest,
  ): Promise<LanguageModelRequest | undefined>;
  acknowledge(operationId: string): Promise<boolean>;
}

export interface WorkflowOperationJournal {
  readonly steering?: WorkflowSteeringStore;
  loadPrepared?(operationId: string): Promise<WorkflowOperationIdentity | undefined>;
  loadOrCreate(identity: WorkflowOperationIdentity): Promise<WorkflowOperationRecord>;
  begin(
    identity: WorkflowOperationIdentity & { readonly revision: number },
  ): Promise<
    { readonly status: 'claimed'; readonly claim: string } | { readonly status: 'blocked' }
  >;
  complete(
    identity: WorkflowOperationIdentity & { readonly claim: string; readonly result: string },
  ): Promise<boolean>;
}
