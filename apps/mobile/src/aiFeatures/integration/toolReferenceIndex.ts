import type {
  EvidenceReference,
  ToolSourceReference,
} from '@orot/agent-runtime';

export type ToolCallScope = {
  readonly operationRunId: string;
  readonly callId: string;
};

/** Projected tool references can recover only aliases issued by this live registry. */
export class ToolReferenceIndex {
  private readonly references = new Map<string, EvidenceReference>();
  private readonly research = new Map<string, EvidenceReference | null>();
  private readonly pendingResearch = new Map<
    string,
    EvidenceReference | null
  >();

  private key(value: ToolSourceReference) {
    return JSON.stringify([
      value.sourceKind,
      value.sourceId,
      value.sourceRevision,
      value.evidenceId,
      value.evidenceRevision,
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
    scope?: ToolCallScope,
    replace = false,
  ) {
    const key = JSON.stringify([
      scope?.operationRunId ?? null,
      scope?.callId ?? null,
      this.key(value),
    ]);
    if (replace) {
      this.research.set(key, alias);
      return;
    }
    const entries = scope ? this.pendingResearch : this.research;
    const previous = entries.get(key);
    if (previous === null) return;
    entries.set(
      key,
      previous && this.key(previous) !== this.key(alias) ? null : alias,
    );
  }

  findResearch(
    value: ToolSourceReference,
    scope?: ToolCallScope,
    ready = false,
  ): EvidenceReference | undefined {
    const entries = scope && !ready ? this.pendingResearch : this.research;
    return (
      entries.get(
        JSON.stringify([
          scope?.operationRunId ?? null,
          scope?.callId ?? null,
          this.key(value),
        ]),
      ) ?? undefined
    );
  }
}
