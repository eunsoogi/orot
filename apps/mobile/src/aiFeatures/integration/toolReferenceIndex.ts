import type {
  EvidenceReference,
  ToolSourceReference,
} from '@orot/agent-runtime';

/** Projected tool references can recover only aliases issued by this live registry. */
export class ToolReferenceIndex {
  private readonly references = new Map<string, EvidenceReference>();
  private readonly research = new Map<string, EvidenceReference | null>();

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
  bindResearch(value: ToolSourceReference, alias: EvidenceReference) {
    const key = this.key(value);
    const previous = this.research.get(key);
    if (previous === null) return;
    this.research.set(
      key,
      previous && this.key(previous) !== this.key(alias) ? null : alias,
    );
  }

  findResearch(value: ToolSourceReference): EvidenceReference | undefined {
    return this.research.get(this.key(value)) ?? undefined;
  }
}
