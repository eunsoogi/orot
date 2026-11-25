import { describe, expect, it } from 'vitest';
import { readInitialReplyPresentation } from '../src/multiAgent/initialReplyPresentation';

describe('reviewed opening presentation descriptor', () => {
  it('returns the same independent review candidate and only an allowlisted layout', () => {
    const text = '살펴볼게요.';
    expect(readInitialReplyPresentation(text)).toEqual({ text });
    expect(readInitialReplyPresentation(JSON.stringify({ text, layout: 'card' }))).toEqual({
      text,
      layout: 'card',
    });
    for (const candidate of [
      { text, layout: 'plain' },
      { text, layout: 'unknown' },
      { text, layout: 'card', action: 'external' },
      { text, layout: { kind: 'Card', children: [] } },
    ]) {
      expect(readInitialReplyPresentation(JSON.stringify(candidate))).toEqual({ text });
    }
  });

  it('never treats a malformed object or an oversized descriptor as prose', () => {
    expect(readInitialReplyPresentation('{')).toBeUndefined();
    expect(readInitialReplyPresentation('{"layout":"card"}')).toBeUndefined();
    expect(readInitialReplyPresentation(JSON.stringify({ text: 'a'.repeat(1024) }))).toBeUndefined();
  });
});
