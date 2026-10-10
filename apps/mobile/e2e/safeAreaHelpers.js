/* global by, element */

const { expect: jestExpect } = require('@jest/globals');
const MINIMUM_KEYBOARD_OCCLUSION_RATIO = 0.25;

/** Confirms the visible keyboard overlaps the scroll viewport without hiding all content. */
async function expectKeyboardOccludesScroll(scrollFrame) {
  const attributes = await element(
    by.id('safe-area-keyboard-visible'),
  ).getAttributes();
  const label = attributes.label || attributes.text || '';
  const match = /^keyboard-visible:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(
    label,
  );
  if (!match) {
    throw new Error(
      `The native keyboard is not visible: ${label || 'no frame'}.`,
    );
  }

  const keyboardTop = Number(match[1]);
  const keyboardHeight = Number(match[2]);
  const scrollBottom = scrollFrame.y + scrollFrame.height;
  const visibleScrollHeight = Math.max(
    0,
    Math.min(scrollBottom, keyboardTop) - scrollFrame.y,
  );
  const occludedScrollHeight = Math.max(
    0,
    Math.min(scrollBottom, keyboardTop + keyboardHeight) -
      Math.max(scrollFrame.y, keyboardTop),
  );

  // Detox and UIKit report these rectangles in screen points.
  jestExpect(keyboardHeight).toBeGreaterThan(0);
  jestExpect(visibleScrollHeight).toBeGreaterThan(0);
  jestExpect(occludedScrollHeight).toBeGreaterThanOrEqual(
    scrollFrame.height * MINIMUM_KEYBOARD_OCCLUSION_RATIO,
  );
}

module.exports = { expectKeyboardOccludesScroll };
