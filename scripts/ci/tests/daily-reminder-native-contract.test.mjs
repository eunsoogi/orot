import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { iosAcceptanceDiagnosticTests } from '../ios-acceptance-diagnostic-inventory.mjs';

const source = readFileSync(
  new URL(
    '../../../apps/mobile/ios/OrotUITests/DailyReminderDeliveryUITests.swift',
    import.meta.url,
  ),
  'utf8',
);
// This checks maintained native-oracle wiring, not execution of system delivery or UI behavior.
test('the opt-in real-banner journey requires the canonical selected Conversation root', () => {
  assert.ok(
    iosAcceptanceDiagnosticTests.includes(
      'OrotUITests/DailyReminderDeliveryUITests/testScheduledDailyReminderOpensPreparationFromSystemBanner',
    ),
  );
  assert.match(source, /navigationAction\(app, "navigation-tab-conversation"\)/u);
  assert.match(source, /XCTAssertTrue\(conversation\.control\.isSelected/u);
  assert.match(source, /XCTAssertFalse\(app\.buttons\["navigation-back"\]\.exists/u);
  assert.match(source, /XCTAssertEqual\(screens\.count, 1/u);
  assert.equal((source.match(/try assertConversationRoot\(app\)/gu) ?? []).length, 2);
  assert.match(
    source,
    /XCTAssertEqual\(UITestConditions\.text\(reportDate\), displayedIdentity\)/u,
  );
});

test('the original real OS and explicit warm/cold boundaries remain in the journey', () => {
  for (const token of [
    'OROT_DAILY_REMINDER_DELIVERY_TEST',
    'OROT_DAILY_REMINDER_DELIVERY_MODE',
    'mode == "cold"',
    'app.terminate()',
    'XCUIDevice.shared.press(.home)',
    'ReminderJourneyObservation.deliveredBanner(',
    'notification.tap()',
    'notification.label == "오늘의 기록을 확인해 보세요."',
    'scheduleReminder(app, status: status)',
  ])
    assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /enqueueSyntheticReply|simctl push/u);
});

// Home is not itself proof of backgrounding; activation must follow observed state.
test('the return observation waits for background and foreground without sleeps', () => {
  assert.match(
    source,
    /wait\(for: \[suspended\]\).*completed[\s\S]*app\.activate\(\)[\s\S]*wait\(for: \[returned\]\).*completed/u,
  );
  assert.doesNotMatch(source, /Thread\.sleep|sleep\(/u);
});

// Fresh core installs must traverse the real appearance form before Settings.
test('daily reminder preparation completes visible onboarding without persistence bypass', () => {
  const helper = readFileSync(
    new URL(
      '../../../apps/mobile/ios/OrotUITests/ReminderJourneyObservation.swift',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(
    source,
    /defer.*terminateStandaloneApp[\s\S]*try ReminderJourneyObservation\.prepareAppearance\(app\)[\s\S]*let settingsTab/u,
  );
  for (const token of [
    'assistant-appearance-scroll',
    'identifier: "별"',
    'star.isHittable',
    'guard !settings.exists, !back.exists, onboarding.exists else { return }',
    'star.tap()',
    'FormUITestConditions.reveal(save',
    'save.isEnabled, save.isHittable',
    'save.tap()',
    'XCTAssertFalse(onboarding.exists)',
  ])
    assert.ok(helper.includes(token), token);
  assert.doesNotMatch(source, /OROT_TEST_ASSISTANT_APPEARANCE|reset\(|preseed\(/u);
});

// Source contract only: Swift assertions below still require their native/host execution.
test('wheel options pad minutes without changing hour or calendar semantics', () => {
  assert.match(source, /minute \? String\(format: "%02d", number\) : String\(number\)/u);
  assert.match(source, /isHour\(value\) != minute/u);
  assert.match(source, /periodValue\.contains\("오전"\) != periodValue\.contains\("오후"\)/u);
  assert.ok(source.includes('Date().addingTimeInterval(180)'));
  assert.ok(source.includes('Calendar.current.dateComponents([.hour, .minute], from: target)'));
});
