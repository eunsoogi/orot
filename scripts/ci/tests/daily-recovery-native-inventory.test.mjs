import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

test('daily recovery has a separate real-restart acceptance case, not consent-grant evidence', () => {
  const id =
    'OrotUITests/DailyReportLocalRecoveryUITests/testPublishedFinalOutputRestartsAndOnlyExplicitCurrentResumeSaves';
  assert.equal(iosTestInventory('provider-selection').filter((value) => value === id).length, 1);
  const swift = readFileSync(
    'apps/mobile/ios/OrotUITests/DailyReportLocalRecoveryUITests.swift',
    'utf8',
  );
  assert.ok(swift.includes('func ' + id.split('/')[2] + '()'));
  assert.ok(swift.includes('app.terminate()'));
  assert.ok(swift.includes('"resume", "cancel", "delete", "revoke"'));
  assert.ok(
    readFileSync('apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj', 'utf8').includes(
      'DailyReportLocalRecoveryUITests.swift in Sources',
    ),
  );
  const session = readFileSync('apps/mobile/e2e/dailyRecoveryNativeSession.ts', 'utf8');
  assert.ok(session.includes('createDailyReportRecoveryOwnerReader'));
  assert.ok(session.includes('createDailyReportLocalRecovery'));
  assert.ok(!session.includes('.authorize('));
  assert.ok(!session.includes('resolveSelectedAiProvider'));
});
