type Shape = {
  readonly keys: readonly string[];
  readonly fields: readonly { key: string; prefix: string }[];
};

/** Encode the existing stable JSON format for a report's immutable facts. The
 * writer only reuses strings and exact key shapes within one serialization.
 * The saved order and legacy treatment of undefined values are unchanged.
 */
export function immutableReportJson(facts: object): string {
  const shapes = new Map<string | undefined, Shape>();
  const quotes = new Map<string, string>();
  const quote = (value: string) => {
    const cached = quotes.get(value);
    if (cached !== undefined) return cached;
    const encoded = JSON.stringify(value);
    // Bound temporary memory without limiting the facts encoded in the digest.
    if (quotes.size < 4096 && value.length <= 64) quotes.set(value, encoded);
    return encoded;
  };
  const write = (value: unknown): string | undefined => {
    if (value === null) return 'null';
    switch (typeof value) {
      case 'string':
        return quote(value);
      case 'number':
        return Number.isFinite(value) ? String(value) : 'null';
      case 'boolean':
        return value ? 'true' : 'false';
      case 'object':
        break;
      default:
        return JSON.stringify(value);
    }
    // Joining the encoded elements also retains the old empty array slots.
    if (Array.isArray(value)) return `[${value.map(write).join(',')}]`;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const first = keys[0];
    let shape = shapes.get(first);
    if (
      !shape ||
      keys.length !== shape.keys.length ||
      shape.keys.some((key, index) => key !== keys[index])
    ) {
      shape = {
        keys,
        fields: [...keys].sort().map((key, index) => ({
          key,
          prefix: `${index ? ',' : ''}${quote(key)}:`,
        })),
      };
      shapes.set(first, shape);
    }
    let result = '{';
    for (const { key, prefix } of shape.fields)
      result += prefix + write(record[key]);
    return result + '}';
  };
  // The immutable facts envelope is always an object.
  return write(facts)!;
}
