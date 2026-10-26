/** Extracts searchable text from LangGraph field paths before it is embedded by Rememori. */
function tokenizePath(path: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (let index = 0; index < path.length; index += 1) {
    const character = path[index]!;
    if (character === '.') {
      if (current) tokens.push(current);
      current = '';
    } else if (character === '[' || character === '{') {
      if (current) tokens.push(current);
      current = '';
      const closer = character === '[' ? ']' : '}';
      const end = path.indexOf(closer, index + 1);
      if (end < 0) throw new Error(`Invalid indexing path: ${path}.`);
      tokens.push(path.slice(index, end + 1));
      index = end;
    } else current += character;
  }
  if (current) tokens.push(current);
  if (path.endsWith('.') || tokens.length === 0) throw new Error(`Invalid indexing path: ${path}.`);
  return tokens;
}

function primitiveText(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (value && typeof value === 'object') return [JSON.stringify(value, null, 2)];
  return [];
}

function extract(value: unknown, tokens: readonly string[], position = 0): string[] {
  if (position >= tokens.length) return primitiveText(value);
  const token = tokens[position]!;
  if (token.startsWith('{') && token.endsWith('}')) {
    return token
      .slice(1, -1)
      .split(',')
      .flatMap((field) => extract(value, tokenizePath(field.trim())));
  }
  if (token.startsWith('[') && token.endsWith(']')) {
    if (!Array.isArray(value)) return [];
    const index = token.slice(1, -1);
    if (index === '*') return value.flatMap((item) => extract(item, tokens, position + 1));
    if (!/^-?\d+$/.test(index)) throw new Error(`Unsupported array index in path: ${token}.`);
    const numericIndex = Number(index);
    const resolvedIndex = numericIndex < 0 ? value.length + numericIndex : numericIndex;
    return resolvedIndex >= 0 && resolvedIndex < value.length
      ? extract(value[resolvedIndex], tokens, position + 1)
      : [];
  }
  if (token === '*') {
    if (Array.isArray(value)) return value.flatMap((item) => extract(item, tokens, position + 1));
    if (value && typeof value === 'object') {
      return Object.values(value).flatMap((item) => extract(item, tokens, position + 1));
    }
    return [];
  }
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, token)) {
    return extract((value as Record<string, unknown>)[token], tokens, position + 1);
  }
  return [];
}

function textAtPath(value: Record<string, unknown>, path: string): string[] {
  if (!path || path === '$') return [JSON.stringify(value, null, 2)];
  return extract(value, tokenizePath(path));
}

export function indexedTexts(
  value: Record<string, unknown>,
  index: false | string[] | undefined,
): string[] {
  if (index === false) return [];
  if (
    index !== undefined &&
    (!Array.isArray(index) || !index.every((path) => typeof path === 'string'))
  ) {
    throw new Error('Index paths must be an array of strings or false.');
  }
  const paths = index ?? ['$'];
  const texts = paths
    .flatMap((path) => textAtPath(value, path))
    .filter((text) => text.trim().length > 0);
  return [...new Set(texts)];
}
