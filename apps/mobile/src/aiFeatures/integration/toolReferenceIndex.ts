import {
  captureToolScope,
  restoreToolScope,
  type ToolRunScope,
  type ToolReferenceScopeSnapshot,
  type ResearchAliasResolver,
  type ToolScopeReceipt,
} from './toolReferenceScopeSnapshot';
import { stableJson } from './evidenceUtils';
import type {
  EvidenceReference,
  ToolSourceReference,
} from '@orot/agent-runtime';

export type RunCallIdentity = {
  readonly operationRunId: string;
  readonly callId: string;
};
export type ToolCallScope = RunCallIdentity & { readonly sessionId: string };

/** Projected tool references can recover only aliases issued by this live registry. */
export class ToolReferenceIndex {
  private readonly references = new Map<string, EvidenceReference>();
  private readonly research = new Map<string, EvidenceReference | null>();
  private readonly pendingResearch = new Map<
    string,
    EvidenceReference | null
  >();

  private readonly restoredScopes = new Set<string>();
  private readonly scopeReceipts = new WeakMap<
    ToolScopeReceipt,
    {
      scope: ToolRunScope;
      aliases: Set<string>;
      ambiguous: boolean;
    }
  >();

  /** Capture only this run, with call identities obtained from its protected execution history. */
  snapshotScope(
    scope: ToolRunScope,
    knownCallIds: readonly string[],
    resolve: ResearchAliasResolver,
  ) {
    return captureToolScope(
      scope,
      knownCallIds,
      resolve,
      this.research,
      this.pendingResearch,
    );
  }

  /** Atomic import into a fresh index; do not merge or promote pending bindings. */
  restoreScope(
    snapshot: ToolReferenceScopeSnapshot,
    scope: ToolRunScope,
    knownCallIds: readonly string[],
    resolve: ResearchAliasResolver,
  ): ToolScopeReceipt {
    const plan = restoreToolScope(snapshot, scope, knownCallIds, resolve);
    if (this.restoredScopes.has(stableJson(scope)))
      throw new Error('Tool scope already restored.');
    for (const entries of [this.research, this.pendingResearch])
      for (const key of entries.keys()) {
        const [session, run] = JSON.parse(key);
        if (session === scope.sessionId && run === scope.operationRunId)
          throw new Error('Tool scope already has a live owner.');
      }
    for (const [key, alias] of plan.ready) this.research.set(key, alias);
    for (const [key, alias] of plan.pending)
      this.pendingResearch.set(key, alias);
    const receipt = Object.freeze({ ...plan.scope });
    this.scopeReceipts.set(receipt, plan);
    this.restoredScopes.add(stableJson(scope));
    return receipt;
  }

  /** A serialized/forged receipt, another registry, or incomplete scope cannot unlock research. */
  acceptsScopeReceipt(
    receipt: ToolScopeReceipt,
    scope: ToolRunScope,
    retained: readonly EvidenceReference[],
  ): boolean {
    const saved = this.scopeReceipts.get(receipt);
    if (
      !saved ||
      saved.ambiguous ||
      stableJson(saved.scope) !== stableJson(scope)
    )
      return false;
    const aliases = new Set<string>();
    for (const entries of [this.research, this.pendingResearch])
      for (const [key, alias] of entries) {
        const [session, run] = JSON.parse(key);
        if (session !== scope.sessionId || run !== scope.operationRunId)
          continue;
        if (alias === null) return false;
        aliases.add(stableJson(alias));
      }
    // Live bindings added by subsequent authorized tool results retain normal tracker semantics.
    return retained.every(alias => aliases.has(stableJson(alias)));
  }

  private key(value: ToolSourceReference) {
    return JSON.stringify([
      value.sourceKind,
      value.sourceId,
      value.sourceRevision,
      value.evidenceId,
      value.evidenceRevision,
    ]);
  }

  private scopedKey(value: ToolSourceReference, scope: ToolCallScope) {
    return JSON.stringify([
      scope.sessionId,
      scope.operationRunId,
      scope.callId,
      this.key(value),
    ]);
  }

  add(value: EvidenceReference) {
    this.references.set(this.key(value), value);
  }

  find(value: ToolSourceReference): EvidenceReference | undefined {
    const reference = this.references.get(this.key(value));
    return reference ? { ...reference } : undefined;
  }

  /** Ambiguous identities fail closed instead of choosing a concurrent search result. */
  bindResearch(
    value: ToolSourceReference,
    alias: EvidenceReference,
    scope: ToolCallScope,
    replace = false,
  ) {
    const key = this.scopedKey(value, scope);
    if (replace) {
      this.research.set(key, alias);
      return;
    }
    const entries = this.pendingResearch;
    const previous = entries.get(key);
    if (previous === null) return;
    entries.set(
      key,
      previous && this.key(previous) !== this.key(alias) ? null : alias,
    );
  }

  findResearch(
    value: ToolSourceReference,
    scope: ToolCallScope,
    ready = false,
  ): EvidenceReference | undefined {
    const entries = ready ? this.research : this.pendingResearch;
    return entries.get(this.scopedKey(value, scope)) ?? undefined;
  }
}
