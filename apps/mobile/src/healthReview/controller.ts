import { SafetyPolicyEngine, SafetyPolicyDecisionSchema } from '@orot/domain';
import type { SafetyPolicyDecision } from '@orot/domain';
import type {
  ExecutionConsentPort,
  HealthReviewResult,
} from '@orot/agent-runtime';
import type { HealthReviewService, HealthReviewExecution } from './service';
import {
  emptyHealthReviewSafety,
  healthReviewSafetyInput,
} from './safetyInput';
import type { HealthReviewSafetyDraft } from './safetyInput';

export interface HealthReviewState {
  name: string;
  draft: HealthReviewSafetyDraft;
  requests: Awaited<ReturnType<HealthReviewService['list']>>;
  sourceId?: string;
  result?: HealthReviewResult;
  invocation?: HealthReviewExecution['invocation'];
  safety?: SafetyPolicyDecision;
  providerStatus?: HealthReviewExecution['providerStatus'];
  consentDenied?: boolean;
  error?: 'input' | 'storage';
  busy: boolean;
}

/** The app-level session owns work through route unmounts; cancellation also revokes late publication. */
export class HealthReviewController {
  private state: HealthReviewState = {
    name: '',
    draft: emptyHealthReviewSafety(),
    requests: [],
    busy: false,
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private operation?: AbortController;
  constructor(private readonly service: HealthReviewService) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(update: Partial<HealthReviewState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach(listener => listener());
  }
  setName = (name: string) => this.publish({ name });
  setDraft = (draft: HealthReviewSafetyDraft) => this.publish({ draft });
  async refresh() {
    const epoch = this.epoch;
    try {
      const requests = await this.service.list();
      if (epoch === this.epoch) this.publish({ requests });
    } catch {
      if (epoch === this.epoch) this.publish({ error: 'storage' });
    }
  }
  select = (sourceId: string) => {
    this.cancel();
    const request = this.state.requests.find(row => row.source.id === sourceId);
    if (!request) return;
    // Selection restores only private pending state. It never runs evidence or inference.
    this.publish({
      sourceId,
      invocation: undefined,
      result: request.pending
        ? { status: 'needs_clarification', pending: request.pending }
        : { status: 'unavailable' },
      safety: request.pending
        ? (request.pending.safety as SafetyPolicyDecision)
        : undefined,
      error: undefined,
      providerStatus: undefined,
      consentDenied: false,
    });
  };
  cancel = () => {
    ++this.epoch;
    this.operation?.abort();
    this.operation = undefined;
    if (this.state.busy)
      this.publish({
        busy: false,
        result: { status: 'cancelled' },
        invocation: undefined,
      });
  };
  async run(consent: ExecutionConsentPort, continuing = false) {
    if (this.state.busy) return;
    let safety;
    try {
      safety = healthReviewSafetyInput(this.state.draft);
      if (!continuing && !this.state.name.trim())
        throw new Error('Name required.');
    } catch {
      this.publish({ error: 'input' });
      return;
    }
    const pending =
      continuing && this.state.result?.status === 'needs_clarification'
        ? this.state.result.pending
        : undefined;
    const sourceId = this.state.sourceId;
    if (continuing && (!pending || !sourceId)) return;
    this.cancel();
    const epoch = this.epoch;
    const operation = new AbortController();
    this.operation = operation;
    // Publish deterministic policy first, before provider resolution or any remote consent prompt.
    this.publish({
      busy: true,
      error: undefined,
      safety: new SafetyPolicyEngine().evaluate(safety),
      providerStatus: undefined,
      consentDenied: false,
      result: undefined,
      invocation: undefined,
    });
    try {
      const execution: HealthReviewExecution & { source?: { id: string } } =
        pending && sourceId
          ? await this.service.continue(
              sourceId,
              pending,
              safety,
              consent,
              operation.signal,
            )
          : await this.service.start(
              this.state.name,
              safety,
              consent,
              operation.signal,
            );
      if (epoch !== this.epoch || operation.signal.aborted) return;
      const graphSafety =
        execution.result.status === 'needs_clarification'
          ? execution.result.pending.safety
          : 'safety' in execution.result
            ? execution.result.safety
            : undefined;
      this.publish({
        ...execution,
        sourceId: execution.source?.id ?? sourceId,
        busy: false,
        ...(graphSafety
          ? { safety: SafetyPolicyDecisionSchema.parse(graphSafety) }
          : {}),
      });
      await this.refresh();
    } catch {
      if (epoch === this.epoch) this.publish({ busy: false, error: 'storage' });
    } finally {
      if (this.operation === operation) this.operation = undefined;
    }
  }
  async delete(sourceId: string) {
    // Cancel before deletion so consent waiters and in-flight providers cannot publish after removal.
    this.cancel();
    const epoch = this.epoch;
    this.publish({ busy: true });
    try {
      await this.service.delete(sourceId);
      if (epoch !== this.epoch) return;
      this.publish({
        busy: false,
        ...(sourceId === this.state.sourceId
          ? {
              sourceId: undefined,
              result: undefined,
              invocation: undefined,
              safety: undefined,
            }
          : {}),
      });
      await this.refresh();
    } catch {
      if (epoch === this.epoch) this.publish({ busy: false, error: 'storage' });
    }
  }
}
