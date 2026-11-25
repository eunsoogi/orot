import { describe, expect, it } from '@jest/globals';
import { readInitialReplyPresentation } from '../src/multiAgent/initialReplyPresentation';

describe('reviewed opening presentation descriptor', () => {
  it('returns the same independent review candidate and only an allowlisted layout', () => {
    const text = '살펴볼게요.';
    expect(readInitialReplyPresentation(text)).toEqual({ text });
    const card = JSON.stringify({ text, layout: 'card' });
    expect(readInitialReplyPresentation(card)).toEqual({ text, layout: 'card' });
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
    const oversized = JSON.stringify({ text: 'a'.repeat(1024) });
    expect(readInitialReplyPresentation(oversized)).toBeUndefined();
  });
});
