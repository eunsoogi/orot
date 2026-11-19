import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIosTestProfileSelection } from '../ios-test-profile-selection.mjs';

const foreground =
  'OrotUITests/ConversationHistoryDuoUITests/testSyntheticLongConversationProfileForeground';
const resize =
  'OrotUITests/ConversationHistoryDuoUITests/testSyntheticLongConversationProfileResize';

function selection(profile, cases, requested, unscoped) {
  return resolveIosTestProfileSelection(
    profile,
    cases,
    undefined,
    undefined,
    undefined,
    undefined,
    { requested, unscoped },
  );
}

test('focused lifecycle admits only the matching single Duo case', () => {
  for (const [mode, selector] of [
    ['foreground', foreground],
    ['resize', resize],
  ]) {
    assert.equal(selection('duo', [selector], mode).fixtureSelection, 'duo');
  }
  for (const [profile, cases, mode, direct] of [
    ['fixtures', [resize], 'resize'],
    ['duo', [resize, foreground], 'resize'],
    ['duo', [foreground], 'resize'],
    ['duo', [foreground], 'YES'],
    ['duo', [foreground], undefined, 'foreground'],
  ]) {
    assert.throws(() => selection(profile, cases, mode, direct), /matching single Duo journey/);
  }
  assert.equal(selection('duo', [resize, foreground]).fixtureSelection, 'duo');
});
