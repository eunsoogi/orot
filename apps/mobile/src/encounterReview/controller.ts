import type {
  EncounterApproval,
  EncounterCandidate,
  EncounterGraphResult,
  EncounterPending,
  ExecutionConsentPort,
} from '@orot/agent-runtime';
import type { ReviewDiagnostics } from './diagnostics';

export type ReviewResult =
  | EncounterGraphResult
  | {
      status:
        'idle' | 'no-transcript' | 'selection-required' | 'consent-denied';
    };
export interface EncounterReviewService {
  diagnostics?: ReviewDiagnostics;
  restore(sourceId: string, signal: AbortSignal): Promise<ReviewResult>;
  start(
    sourceId: string,
    consent: ExecutionConsentPort,
    signal: AbortSignal,
  ): Promise<ReviewResult>;
  decide(
    sourceId: string,
    approval: EncounterApproval,
    signal: AbortSignal,
  ): Promise<ReviewResult>;
}
export interface ReviewState {
  status: ReviewResult['status'] | 'loading' | 'running' | 'saving';
  pending?: EncounterPending;
  candidates: EncounterCandidate[];
  selected: string[];
}

/** One controller owns a source for its mounted lifetime; geometry never controls its identity. */
export class EncounterReviewController {
  state: ReviewState = { status: 'loading', candidates: [], selected: [] };
  private operation?: AbortController;
  private disposed = false;
  constructor(
    readonly sourceId: string,
    private readonly service: EncounterReviewService,
    private readonly publish: (state: ReviewState) => void,
  ) {}
  private set(state: ReviewState) {
    if (this.disposed) return;
    this.state = state;
    this.publish(state);
  }
  get busy() {
    return Boolean(this.operation);
  }
  get dirty() {
    return this.state.status === 'pending';
  }
  private async run(
    status: 'loading' | 'running' | 'saving',
    action: (signal: AbortSignal) => Promise<ReviewResult>,
  ) {
    if (this.operation || this.disposed) return;
    const operation = new AbortController();
    this.operation = operation;
    this.service.diagnostics?.begin(status, this.sourceId);
    const diagnostics = this.service.diagnostics?.current();
    this.set({ ...this.state, status });
    let result: ReviewResult;
    try {
      result = await action(operation.signal);
    } catch (error) {
      diagnostics?.caught(error);
      result = { status: 'unavailable' };
    }
    if (this.operation !== operation || this.disposed) return;
    this.operation = undefined;
    if (operation.signal.aborted) result = { status: 'cancelled' };
    if (result.status === 'pending') {
      // Keep the displayed original immutable. Edits and exclusions are a separate gesture payload.
      const pending = JSON.parse(
        JSON.stringify(result.pending),
      ) as EncounterPending;
      this.set({
        status: 'pending',
        pending,
        candidates: pending.candidates.map(candidate => ({ ...candidate })),
        selected: pending.candidates.map(candidate => candidate.id),
      });
    } else this.set({ status: result.status, candidates: [], selected: [] });
    diagnostics?.settled(this.state.status);
  }
  restore() {
    return this.run('loading', signal =>
      this.service.restore(this.sourceId, signal),
    );
  }
  activate() {
    this.disposed = false;
  }
  start(consent: ExecutionConsentPort) {
    return this.run('running', signal =>
      this.service.start(this.sourceId, consent, signal),
    );
  }
  edit(id: string, field: 'text' | 'dosageInstruction', text: string) {
    if (this.busy || this.state.status !== 'pending') return;
    this.set({
      ...this.state,
      candidates: this.state.candidates.map(candidate =>
        candidate.id === id &&
        (field === 'text' || candidate.kind === 'medication')
          ? { ...candidate, [field]: text }
          : candidate,
      ),
    });
  }
  toggle(id: string) {
    if (this.busy || this.state.status !== 'pending') return;
    this.set({
      ...this.state,
      selected: this.state.selected.includes(id)
        ? this.state.selected.filter(value => value !== id)
        : [...this.state.selected, id],
    });
  }
  decide(decision: 'approve' | 'deny') {
    if (this.busy || this.state.status !== 'pending' || !this.state.pending)
      return Promise.resolve();
    const approval: EncounterApproval = {
      pending: this.state.pending,
      decision,
      candidates:
        decision === 'deny'
          ? []
          : this.state.candidates
              .filter(candidate => this.state.selected.includes(candidate.id))
              .map(candidate =>
                // Removing an optional description must not submit an invalid empty dosage string.
                candidate.dosageInstruction !== undefined &&
                !candidate.dosageInstruction.trim()
                  ? { ...candidate, dosageInstruction: undefined }
                  : candidate,
              ),
      reviewerId: 'local-user',
      reviewedAt: new Date().toISOString(),
    };
    return this.run('saving', signal =>
      this.service.decide(this.sourceId, approval, signal),
    );
  }
  cancel() {
    this.operation?.abort();
  }
  dispose() {
    this.disposed = true;
    const operation = this.operation;
    this.operation = undefined;
    operation?.abort();
  }
}
