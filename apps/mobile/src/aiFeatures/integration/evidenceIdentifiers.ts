/** Keeps textual redaction and source-scope aliases local across supplemental searches. */
export class LocalEvidenceIdentifiers {
  private readonly sensitive = new Map<string, string>();
  private readonly sources = new Map<string, string>();
  private readonly aliases = new Map<string, string>();

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
