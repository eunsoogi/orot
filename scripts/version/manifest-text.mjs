function skipWhitespace(source, start) {
  let index = start;
  while (index < source.length && /[\t\r\n ]/.test(source[index])) index += 1;
  return index;
}

function skipString(source, start) {
  if (source[start] !== '"') throw new Error('expected a JSON string');
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === '"') return index + 1;
    index += 1;
  }
  throw new Error('unterminated JSON string');
}

function skipValue(source, start) {
  const first = source[start];
  if (first === '"') return skipString(source, start);

  if (first === '{' || first === '[') {
    const expectedClosers = [first === '{' ? '}' : ']'];
    let index = start + 1;
    while (index < source.length && expectedClosers.length > 0) {
      const character = source[index];
      if (character === '"') {
        index = skipString(source, index);
        continue;
      }
      if (character === '{' || character === '[') {
        expectedClosers.push(character === '{' ? '}' : ']');
      } else if (character === '}' || character === ']') {
        if (expectedClosers.pop() !== character) throw new Error('mismatched JSON delimiter');
      }
      index += 1;
    }
    if (expectedClosers.length === 0) return index;
    throw new Error('unterminated JSON value');
  }

  let index = start;
  while (index < source.length && !/[\t\r\n ,}\]]/.test(source[index])) index += 1;
  if (index === start) throw new Error('expected a JSON value');
  return index;
}

// Replacing one top-level token preserves sibling formatting, ordering, and line endings.
export function replaceTopLevelJsonStringProperty(source, propertyName, value, path) {
  let index = skipWhitespace(source, 0);
  if (source[index] !== '{') throw new Error(`expected a JSON object in ${path}`);
  index += 1;
  let replacement = null;

  while (index < source.length) {
    index = skipWhitespace(source, index);
    if (source[index] === '}') break;

    const keyStart = index;
    index = skipString(source, index);
    const key = JSON.parse(source.slice(keyStart, index));
    index = skipWhitespace(source, index);
    if (source[index] !== ':') throw new Error(`expected a property separator in ${path}`);
    index = skipWhitespace(source, index + 1);

    const valueStart = index;
    const valueEnd = skipValue(source, valueStart);
    if (key === propertyName) {
      if (replacement) throw new Error(`duplicate ${propertyName} fields in ${path}`);
      if (
        source[valueStart] !== '"' ||
        typeof JSON.parse(source.slice(valueStart, valueEnd)) !== 'string'
      ) {
        throw new Error(`${propertyName} field must be a string in ${path}`);
      }
      replacement = { start: valueStart, end: valueEnd };
    }

    index = skipWhitespace(source, valueEnd);
    if (source[index] === ',') {
      index += 1;
      continue;
    }
    if (source[index] === '}') break;
    throw new Error(`expected another property or object end in ${path}`);
  }

  if (!replacement) throw new Error(`${propertyName} field is missing from ${path}`);
  return `${source.slice(0, replacement.start)}${JSON.stringify(value)}${source.slice(replacement.end)}`;
}
