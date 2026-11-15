export interface EvidenceIdentifierSnapshot {
  readonly sensitive: readonly (readonly [string, string])[];
  readonly sources: readonly (readonly [string, string])[];
}

/** Keeps textual redaction and source-scope aliases local across supplemental searches. */
export class LocalEvidenceIdentifiers {
  private readonly sensitive = new Map<string, string>();
  private readonly sources = new Map<string, string>();
  private readonly aliases = new Map<string, string>();

  /** Private protected-storage data, never a provider payload or logging value. */
  snapshot(): EvidenceIdentifierSnapshot {
    return { sensitive: [...this.sensitive], sources: [...this.sources] };
  }

  static restore(value: EvidenceIdentifierSnapshot): LocalEvidenceIdentifiers {
    const restored = new LocalEvidenceIdentifiers();
    const read = (pairs: unknown): [string, string][] => {
      if (
        !Array.isArray(pairs) ||
        pairs.some(
          pair =>
            !Array.isArray(pair) ||
            pair.length !== 2 ||
            pair.some(item => typeof item !== 'string' || !item),
        )
      )
        throw new Error('Invalid private identifier snapshot.');
      if (
        new Set(pairs.map(pair => pair[0])).size !== pairs.length ||
        new Set(pairs.map(pair => pair[1])).size !== pairs.length
      )
        throw new Error('Conflicting private identifier snapshot.');
      return pairs;
    };
    const sensitive = read(value?.sensitive);
    sensitive.forEach(([raw, alias], index) => {
      if (alias !== `local-id-${index + 1}`)
        throw new Error('Invalid redaction alias.');
      restored.sensitive.set(raw, alias);
    });
    for (const [alias, raw] of read(value?.sources)) {
      if (!/^s[1-9][0-9]*$/.test(alias) || !restored.sensitive.has(raw))
        throw new Error('Invalid source alias.');
      restored.sources.set(alias, raw);
      restored.aliases.set(raw, alias);
    }
    return restored;
  }

  register(value: string): string {
    if (!value) return '';
    const existing = this.sensitive.get(value);
    if (existing) return existing;
    const alias = `local-id-${this.sensitive.size + 1}`;
    this.sensitive.set(value, alias);
    return alias;
  }

  sourceAlias(value: string, suggestedAlias: string): string {
    const alias = this.aliases.get(value) ?? suggestedAlias;
    this.aliases.set(value, alias);
    this.sources.set(alias, value);
    return alias;
  }

  /** Unknown provider aliases resolve to no scope, never an unrestricted search. */
  localSources(aliases: readonly string[]): readonly string[] {
    return [
      ...new Set(
        aliases.flatMap(alias => {
          const local = this.sources.get(alias);
          return local ? [local] : [];
        }),
      ),
    ];
  }

  redact(value: string): string {
    // Replace long IDs first so a prefix ID cannot expose the rest of another identifier.
    return [...this.sensitive.entries()]
      .sort(([left], [right]) => right.length - left.length)
      .reduce(
        (text, [identifier, alias]) => text.split(identifier).join(alias),
        value,
      );
  }
}
