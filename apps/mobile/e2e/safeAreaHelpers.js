/* global by, element */

const { expect: jestExpect } = require('@jest/globals');
const MINIMUM_KEYBOARD_OCCLUSION_RATIO = 0.25;
const MINIMUM_TOP_SAFE_AREA_POINTS = 44;
const MINIMUM_BOTTOM_SAFE_AREA_POINTS = 20;

/** Reads UIKit screen coordinates and rejects missing measurement evidence. */
async function frameOf(target, description) {
  const attributes = await target.getAttributes();
  if (!attributes.frame) {
    throw new Error(`Detox did not return a frame for ${description}.`);
  }
  return attributes.frame;
}

async function frameFor(testID) {
  return frameOf(element(by.id(testID)), testID);
}

/** Checks route content against the UIKit status and home-indicator insets in points. */
async function expectScrollInsideRootFrame(scrollTestID, rootTestID) {
  const root = await frameFor(rootTestID);
  const scroll = await frameFor(scrollTestID);

  // Require meaningful edge clearance so a 1-point padding regression fails.
  jestExpect(scroll.y - root.y).toBeGreaterThanOrEqual(
    MINIMUM_TOP_SAFE_AREA_POINTS,
  );
  jestExpect(
    root.y + root.height - scroll.y - scroll.height,
  ).toBeGreaterThanOrEqual(MINIMUM_BOTTOM_SAFE_AREA_POINTS);
}

async function expectRouteScrollTopInset(scrollTestID, rootTestID) {
  await expectElementBelowTopInset(scrollTestID, rootTestID);
}

async function expectElementBelowTopInset(elementTestID, rootTestID) {
  const root = await frameFor(rootTestID);
  const target = await frameFor(elementTestID);

  jestExpect(target.y - root.y).toBeGreaterThanOrEqual(
    MINIMUM_TOP_SAFE_AREA_POINTS,
  );
}

async function expectElementAboveBottomInset(elementTestID, rootTestID) {
  const root = await frameFor(rootTestID);
  const target = await frameFor(elementTestID);

  jestExpect(
    root.y + root.height - target.y - target.height,
  ).toBeGreaterThanOrEqual(MINIMUM_BOTTOM_SAFE_AREA_POINTS);
}

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

/** A floating bar overlays the viewport while leaving the current action fully reachable. */
async function expectFloatingViewport(scrollID, actionID) {
  const frames = [];
  for (const id of [
    'navigation-keyboard-avoiding-root',
    scrollID,
    'navigation-native-toolbar',
    actionID,
  ]) {
    const { frame } = await element(by.id(id)).getAttributes();
    if (!frame) throw new Error(`Missing native frame for ${id}.`);
    frames.push(frame);
  }
  const [root, scroll, toolbar, action] = frames;
  jestExpect(scroll.y + scroll.height).toBeCloseTo(root.y + root.height, 0);
  jestExpect(action.y + action.height).toBeLessThanOrEqual(toolbar.y);
}

/** The last content remains completely above the floating bar after scrolling to the end. */
async function expectContentAboveFloatingBar(scrollID, contentID) {
  await element(by.id(scrollID)).scrollTo('bottom', 0.5, 0.2);
  const content = await frameOf(element(by.id(contentID)), contentID);
  const toolbar = await frameOf(
    element(by.id('navigation-native-toolbar')),
    'floating toolbar',
  );
  jestExpect(content.y + content.height).toBeLessThanOrEqual(toolbar.y - 16);
}

module.exports = {
  expectElementAboveBottomInset,
  expectElementBelowTopInset,
  expectContentAboveFloatingBar,
  expectKeyboardOccludesScroll,
  expectFloatingViewport,
  expectRouteScrollTopInset,
  expectScrollInsideRootFrame,
  frameFor,
  frameOf,
};
