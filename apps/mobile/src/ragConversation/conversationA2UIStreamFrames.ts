const maxBufferedUnits = 36_000;
const maxFrames = 12;

// Only the selected provider's structured result envelope is admissible. The
// format's outer keys are ordered; the result object's own keys can vary.
const envelope = /^\s*\{\s*"type"\s*:\s*"result"\s*,\s*"value"\s*:\s*\{/u;

function skipSpace(raw: string, from: number): number {
  while (/\s/u.test(raw[from] ?? '')) from += 1;
  return from;
}

function stringEnd(raw: string, from: number): number | undefined {
  for (let i = from + 1; i < raw.length; i += 1) {
    if (raw[i] === '\\') i += 1;
    else if (raw[i] === '"') return i + 1;
  }
  return undefined;
}

// Bound work and skip quoted/nested values without inspecting their contents
// for frame-like text. A complete prefix must parse before crossing a key.
function valueEnd(raw: string, from: number): number | undefined {
  if (raw[from] === '"') return stringEnd(raw, from);
  const stack: string[] = [];
  for (let i = from; i < raw.length; i += 1) {
    const part = raw[i];
    if (part === '"') {
      const end = stringEnd(raw, i);
      if (end === undefined) return undefined;
      i = end - 1;
    } else if (part === '{' || part === '[') {
      if (stack.length >= 24) return undefined;
      stack.push(part === '{' ? '}' : ']');
    } else if (part === '}' || part === ']') {
      if (!stack.length) return i;
      if (stack.pop() !== part) return undefined;
      if (!stack.length) return i + 1;
    } else if (part === ',' && !stack.length) return i;
  }
  return undefined;
}

function ownFrameArray(raw: string, start: number): number | undefined {
  let from = skipSpace(raw, start);
  const seen = new Set<string>();
  let ordinary = false;
  try {
    while (raw[from] === '"' && seen.size < 32) {
      const end = stringEnd(raw, from);
      if (end === undefined) return undefined;
      const key: string = JSON.parse(raw.slice(from, end));
      const colon = skipSpace(raw, end);
      if (seen.has(key) || raw[colon] !== ':') return undefined;
      seen.add(key);
      from = skipSpace(raw, colon + 1);
      if (key === 'a2uiFrames')
        return ordinary && raw[from] === '[' ? from + 1 : undefined;
      const limit = valueEnd(raw, from);
      if (limit === undefined) return undefined;
      const value: unknown = JSON.parse(raw.slice(from, limit));
      if (key === 'answerKind') ordinary = value === 'conversation';
      const delimiter = skipSpace(raw, limit);
      if (raw[delimiter] !== ',') return undefined;
      from = skipSpace(raw, delimiter + 1);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Complete delimited frames only; no values escape to presentation. */
export function completeConversationSkeletonFrames(
  raw: string,
  allowObjectFrames = false,
) {
  if (raw.length > maxBufferedUnits) return undefined;
  const prefix = envelope.exec(raw);
  if (!prefix) return undefined;
  let offset = ownFrameArray(raw, prefix[0].length);
  if (offset === undefined) return undefined;
  const frames: string[] = [];
  for (;;) {
    offset = skipSpace(raw, offset);
    if (offset === raw.length) return frames;
    if (raw[offset] === ']') return frames.length === 0 ? frames : undefined;
    const objectFrame = allowObjectFrames && raw[offset] === '{';
    if ((raw[offset] !== '"' && !objectFrame) || frames.length >= maxFrames)
      return undefined;
    const end = objectFrame ? valueEnd(raw, offset) : stringEnd(raw, offset);
    if (end === undefined) return frames;
    const delimiter = skipSpace(raw, end);
    if (delimiter === raw.length) return frames;
    if (raw[delimiter] !== ']' && raw[delimiter] !== ',') return undefined;
    try {
      const token = raw.slice(offset, end);
      // Keep object bytes private and let the same downstream wire parser
      // validate shape, scope and provenance for either representation.
      const frame: string = objectFrame ? token : JSON.parse(token);
      frames.push(frame);
    } catch {
      return undefined;
    }
    if (raw[delimiter] === ']') return frames;
    offset = delimiter + 1;
  }
}
