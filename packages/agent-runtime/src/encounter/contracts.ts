import type { BaseCheckpointSaver, BaseStore } from '@langchain/langgraph/web';

export interface EncounterSegment {
  id: string;
  transcriptId: string;
  revision: number;
  text: string;
  effectiveAt: string;
  audioRange: { startMs: number; endMs: number };
}

export interface EncounterTranscript {
  sourceId: string;
  segments: EncounterSegment[];
}

export interface EncounterEvidence {
  segmentId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
}

export interface EncounterCandidate {
  id: string;
  kind: 'medication' | 'plan';
  text: string;
  dosageInstruction?: string;
  // Speech text supplies no authenticated clinician identity or diarization confidence.
  speaker: 'unknown';
  evidence: EncounterEvidence[];
}

export interface EncounterConflict {
  candidateId: string;
  recordId: string;
  description: string;
  version: string;
}

export interface EncounterPending {
  threadId: string;
  sourceId: string;
  segments: Omit<EncounterSegment, 'text'>[];
  candidates: EncounterCandidate[];
  conflicts: EncounterConflict[];
}

/** A host gesture approves this exact snapshot and optional text edits, never a model-supplied flag. */
export interface EncounterApproval {
  pending: EncounterPending;
  decision: 'approve' | 'deny';
  candidates: EncounterCandidate[];
  reviewerId: string;
  reviewedAt: string;
}

export interface EncounterGraphPort {
  load(sourceId: string, signal: AbortSignal): Promise<EncounterTranscript>;
  extract(transcript: EncounterTranscript, signal: AbortSignal): Promise<EncounterCandidate[]>;
  conflicts(candidates: EncounterCandidate[], signal: AbortSignal): Promise<EncounterConflict[]>;
  /** Must atomically validate source/conflict freshness, approval and evidence before idempotent writes. */
  persist(
    pending: EncounterPending,
    approval: EncounterApproval,
    signal: AbortSignal,
  ): Promise<string[]>;
}

/** Fixed labels only: diagnostics must never receive error text or graph data. */
export interface EncounterDiagnosticFailure {
  stage:
    | 'checkpoint_read'
    | 'resume_validation'
    | 'graph_invoke'
    | 'load_transcript'
    | 'extract_candidates'
    | 'detect_conflicts'
    | 'user_confirmation'
    | 'persist_records'
    | 'checkpoint_source'
    | 'checkpoint_result'
    | 'checkpoint_pending'
    | 'approval_without_checkpoint'
    | 'graph_result'
    | 'extraction_result';
  category:
    | 'type_error'
    | 'range_error'
    | 'error'
    | 'UNKNOWN'
    | 'unavailable'
    | 'workflow_unavailable'
    | 'workflow_invalid_output'
    | 'workflow_budget_exceeded'
    | 'workflow_consent_required'
    | 'workflow_stale_evidence'
    | 'workflow_cancelled'
    | 'workflow_needs_clarification';
}

export interface EncounterGraphOptions {
  threadId: string;
  sourceId: string;
  checkpointer: BaseCheckpointSaver;
  store?: BaseStore;
  port: EncounterGraphPort;
  signal?: AbortSignal;
  approval?: EncounterApproval;
  onDiagnostic?: (failure: EncounterDiagnosticFailure) => void;
}

export type EncounterGraphResult =
  | { status: 'pending'; pending: EncounterPending }
  | { status: 'saved'; recordIds: string[] }
  | { status: 'denied' | 'cancelled' | 'unavailable' };
