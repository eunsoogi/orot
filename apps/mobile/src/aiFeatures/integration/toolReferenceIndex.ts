import type {
  EvidenceReference,
  ToolSourceReference,
} from '@orot/agent-runtime';

/** Projected tool references can recover only aliases issued by this live registry. */
export class ToolReferenceIndex {
  private readonly references = new Map<string, EvidenceReference>();

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
}
