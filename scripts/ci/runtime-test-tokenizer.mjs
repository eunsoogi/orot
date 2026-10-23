/** Tokenize source without executing it while preserving template loader expressions. */

const REGEX_PREFIXES = new Set([
  '!',
  '!=',
  '!==',
  '&&',
  '(',
  ',',
  ':',
  ';',
  '=',
  '==',
  '===',
  '=>',
  '?',
  '??',
  '[',
  '{',
  '|',
  '||',
]);

export function scanRegion(source, start = 0, stopAtBrace = false) {
  const tokens = [];
  let index = start;
  let braceDepth = 0;
  let lineBreakBefore = false;

  const add = (type, value, tokenStart) => {
    tokens.push({ type, value, start: tokenStart, lineBreakBefore });
    lineBreakBefore = false;
  };

  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      if (character === '\n' || character === '\r') lineBreakBefore = true;
      index += 1;
      continue;
    }
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index + 2);
      if (end < 0) return { tokens, index: source.length };
      index = end + 1;
      lineBreakBefore = true;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) throw new Error('unclosed block comment');
      if (/[\r\n]/.test(source.slice(index, end))) lineBreakBefore = true;
      index = end + 2;
      continue;
    }
    if (stopAtBrace && character === '}' && braceDepth === 0) {
      return { tokens, index: index + 1 };
    }
    if (character === '"' || character === "'") {
      const tokenStart = index;
      const quote = character;
      index += 1;
      let value = '';
      let escaped = false;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') {
          escaped = true;
          index += 1;
          if (index >= source.length) break;
        }
        if (source[index] === '\n' || source[index] === '\r')
          throw new Error('unclosed string literal');
        value += source[index++];
      }
      if (source[index] !== quote) throw new Error('unclosed string literal');
      index += 1;
      add('string', escaped ? null : value, tokenStart);
      continue;
    }
    if (character === '`') {
      const tokenStart = index;
      index += 1;
      let value = '';
      let escaped = false;
      let interpolated = false;
      const embeddedTokens = [];
      while (index < source.length) {
        if (source[index] === '\\') {
          escaped = true;
          index += 2;
          continue;
        }
        if (source[index] === '`') break;
        if (source.startsWith('${', index)) {
          interpolated = true;
          const expression = scanRegion(source, index + 2, true);
          embeddedTokens.push(...expression.tokens);
          index = expression.index;
          continue;
        }
        value += source[index++];
      }
      if (source[index] !== '`') throw new Error('unclosed template literal');
      index += 1;
      add('template', !escaped && !interpolated ? value : null, tokenStart);
      tokens.push(...embeddedTokens);
      continue;
    }
    if (
      character === '/' &&
      (tokens.length === 0 ||
        REGEX_PREFIXES.has(tokens.at(-1).value) ||
        ['await', 'case', 'return', 'throw', 'yield'].includes(tokens.at(-1).value))
    ) {
      const tokenStart = index++;
      let characterClass = false;
      let escaped = false;
      while (index < source.length) {
        const current = source[index++];
        if (current === '\n' || current === '\r') throw new Error('unclosed regular expression');
        if (escaped) escaped = false;
        else if (current === '\\') escaped = true;
        else if (current === '[') characterClass = true;
        else if (current === ']') characterClass = false;
        else if (current === '/' && !characterClass) break;
      }
      if (source[index - 1] !== '/') throw new Error('unclosed regular expression');
      while (index < source.length && /[A-Za-z]/.test(source[index])) index += 1;
      add('regex', null, tokenStart);
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const tokenStart = index;
      index += 1;
      while (index < source.length && /[\w$]/.test(source[index])) index += 1;
      add('identifier', source.slice(tokenStart, index), tokenStart);
      continue;
    }
    const tokenStart = index++;
    if (character === '{') braceDepth += 1;
    if (character === '}' && braceDepth > 0) braceDepth -= 1;
    add('punctuation', character, tokenStart);
  }
  if (stopAtBrace) throw new Error('unclosed template expression');
  return { tokens, index };
}
