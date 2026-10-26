import type { MultiAgentResponderStreamEvent } from './contracts';

type JsonPathPart = string | number;

/** Keeps append-only display updates compact and represents revised text as a replacement. */
export function projectDisplayTextUpdate(
  previous: string,
  next: string,
): MultiAgentResponderStreamEvent | undefined {
  if (previous === next) return undefined;
  return next.startsWith(previous)
    ? { type: 'text_delta', text: next.slice(previous.length) }
    : { type: 'text_snapshot', text: next };
}

type ReadResult =
  | { readonly status: 'found'; readonly text: string }
  | { readonly status: 'missing' | 'incomplete' };

interface ParsedString {
  readonly value: string;
  readonly complete: boolean;
}

/** Reads one string field from an incomplete JSON stream without exposing neighboring fields. */
export function extractPartialJsonStringAtPath(
  source: string,
  path: readonly JsonPathPart[],
): string | undefined {
  if (!source || !path.length) return undefined;
  const reader = new PartialJsonStringPathReader(source);
  const result = reader.read(path);
  return result.status === 'found' ? result.text : undefined;
}

class PartialJsonStringPathReader {
  private index = 0;

  constructor(private readonly source: string) {}

  read(path: readonly JsonPathPart[]): ReadResult {
    this.skipWhitespace();
    return this.readValue(path, true);
  }

  private readValue(path: readonly JsonPathPart[], capture: boolean): ReadResult {
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === '{') return this.readObject(path, capture);
    if (character === '[') return this.readArray(path, capture);
    if (character === '"') {
      if (!capture || path.length) return this.skipValue();
      const parsed = this.readString(true);
      return { status: 'found', text: parsed.value };
    }
    return this.skipValue();
  }

  private readObject(path: readonly JsonPathPart[], capture: boolean): ReadResult {
    this.index += 1;
    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] === '}') {
        this.index += 1;
        return { status: 'missing' };
      }
      if (this.source[this.index] !== '"') return { status: 'incomplete' };
      const key = this.readString(true);
      if (!key.complete) return { status: 'incomplete' };
      this.skipWhitespace();
      if (this.source[this.index] !== ':') return { status: 'incomplete' };
      this.index += 1;
      this.skipWhitespace();
      const matches = capture && typeof path[0] === 'string' && key.value === path[0];
      const value = matches ? this.readValue(path.slice(1), true) : this.skipValue();
      if (value.status === 'found' || value.status === 'incomplete') return value;
      this.skipWhitespace();
      if (this.source[this.index] === ',') {
        this.index += 1;
        continue;
      }
      if (this.source[this.index] === '}') {
        this.index += 1;
        return { status: 'missing' };
      }
      return { status: 'incomplete' };
    }
  }

  private readArray(path: readonly JsonPathPart[], capture: boolean): ReadResult {
    this.index += 1;
    let itemIndex = 0;
    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] === ']') {
        this.index += 1;
        return { status: 'missing' };
      }
      const matches = capture && typeof path[0] === 'number' && itemIndex === path[0];
      const value = matches ? this.readValue(path.slice(1), true) : this.skipValue();
      if (value.status === 'found' || value.status === 'incomplete') return value;
      this.skipWhitespace();
      if (this.source[this.index] === ',') {
        this.index += 1;
        itemIndex += 1;
        continue;
      }
      if (this.source[this.index] === ']') {
        this.index += 1;
        return { status: 'missing' };
      }
      return { status: 'incomplete' };
    }
  }

  private skipValue(): ReadResult {
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === '{') return this.skipObject();
    if (character === '[') return this.skipArray();
    if (character === '"') {
      const parsed = this.readString(false);
      return { status: parsed.complete ? 'missing' : 'incomplete' };
    }
    const start = this.index;
    while (this.index < this.source.length) {
      const current = this.source[this.index]!;
      if (current === ',' || current === '}' || current === ']' || /\s/u.test(current))
        return this.index > start ? { status: 'missing' } : { status: 'incomplete' };
      this.index += 1;
    }
    // A primitive at the end may still be extended by the next stream update.
    return { status: 'incomplete' };
  }

  private skipObject(): ReadResult {
    this.index += 1;
    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] === '}') {
        this.index += 1;
        return { status: 'missing' };
      }
      if (this.source[this.index] !== '"') return { status: 'incomplete' };
      if (!this.readString(false).complete) return { status: 'incomplete' };
      this.skipWhitespace();
      if (this.source[this.index] !== ':') return { status: 'incomplete' };
      this.index += 1;
      if (this.skipValue().status === 'incomplete') return { status: 'incomplete' };
      this.skipWhitespace();
      if (this.source[this.index] === ',') {
        this.index += 1;
        continue;
      }
      if (this.source[this.index] === '}') {
        this.index += 1;
        return { status: 'missing' };
      }
      return { status: 'incomplete' };
    }
  }

  private skipArray(): ReadResult {
    this.index += 1;
    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] === ']') {
        this.index += 1;
        return { status: 'missing' };
      }
      if (this.skipValue().status === 'incomplete') return { status: 'incomplete' };
      this.skipWhitespace();
      if (this.source[this.index] === ',') {
        this.index += 1;
        continue;
      }
      if (this.source[this.index] === ']') {
        this.index += 1;
        return { status: 'missing' };
      }
      return { status: 'incomplete' };
    }
  }

  private readString(capture: boolean): ParsedString {
    this.index += 1;
    let value = '';
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      this.index += 1;
      if (character === '"') return { value: capture ? value : '', complete: true };
      if (character === '\\') {
        if (this.index >= this.source.length)
          return { value: capture ? completePrefix(value, false) : '', complete: false };
        const escape = this.source[this.index]!;
        this.index += 1;
        const escaped = this.readEscape(escape);
        if (!escaped.complete)
          return { value: capture ? completePrefix(value, false) : '', complete: false };
        if (capture) value += escaped.value;
        continue;
      }
      if (character.charCodeAt(0) < 0x20)
        return { value: capture ? completePrefix(value, false) : '', complete: false };
      if (capture) value += character;
    }
    return { value: capture ? completePrefix(value, false) : '', complete: false };
  }

  private readEscape(escape: string): ParsedString {
    const escapedCharacters: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    if (escape in escapedCharacters) return { value: escapedCharacters[escape]!, complete: true };
    if (escape !== 'u' || this.index + 4 > this.source.length)
      return { value: '', complete: false };
    const digits = this.source.slice(this.index, this.index + 4);
    if (!/^[0-9a-f]{4}$/iu.test(digits)) return { value: '', complete: false };
    this.index += 4;
    return { value: String.fromCharCode(Number.parseInt(digits, 16)), complete: true };
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length && /\s/u.test(this.source[this.index]!)) this.index += 1;
  }
}

/** Avoid rendering half of a non-BMP character while a JSON string is still arriving. */
function completePrefix(value: string, complete: boolean): string {
  if (complete || !value.length) return value;
  const trailing = value.charCodeAt(value.length - 1);
  return trailing >= 0xd800 && trailing <= 0xdbff ? value.slice(0, -1) : value;
}
