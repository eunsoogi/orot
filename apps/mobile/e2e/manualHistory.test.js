/* global by, device, element, waitFor */

async function expectVisible(id) {
  await waitFor(element(by.id(id))).toBeVisible().withTimeout(30000);
}

async function expectHistoryText(text) {
  await expect(
    element(by.text(text).withAncestor(by.id('manual-history-correction-history'))),
  ).toBeVisible();
}

async function expectTwoRecordedVersions() {
  const recordedRows = element(by.id('manual-history-recorded-at'));
  await waitFor(recordedRows.atIndex(0)).toBeVisible().withTimeout(30000);
  await waitFor(recordedRows.atIndex(1)).toBeVisible().withTimeout(30000);
}

async function openManualHistory() {
  await element(by.id('open-manual-history')).tap();
}

async function createUnknownDateEntry() {
  await element(by.id('manual-history-add')).tap();
  await element(by.id('manual-history-title-input')).replaceText('Synthetic history entry');
  await element(by.id('manual-history-details-input')).replaceText(
    'Synthetic details for the manual history simulator test.',
  );
  await element(by.id('manual-history-details-input')).tapReturnKey();
  await element(by.id('manual-history-date-unknown')).tap();
  await expectVisible('manual-history-date-unknown-selected');
  await element(by.id('manual-history-save')).tap();
}

async function createKnownDateEntry() {
  await element(by.id('manual-history-add')).tap();
  await element(by.id('manual-history-title-input')).replaceText('Synthetic dated history entry');
  await element(by.id('manual-history-details-input')).replaceText(
    'Synthetic details for the dated history simulator test.',
  );
  await element(by.id('manual-history-details-input')).tapReturnKey();
  await element(by.id('manual-history-effective-date-input')).replaceText('2024-02-09');
  await element(by.id('manual-history-effective-date-input')).tapReturnKey();
  await element(by.id('manual-history-save')).tap();
}

describe('manual medical history', () => {
  beforeEach(async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
  });

  it('persists explicit unknown-date entries and immutable correction history across restarts', async () => {
    await device.launchApp();
    await expectVisible('welcome-title');
    await openManualHistory();
    await expectVisible('manual-history-empty');

    await createUnknownDateEntry();
    await waitFor(element(by.text('Synthetic history entry'))).toBeVisible().withTimeout(30000);
    await expect(element(by.text('Effective date unknown'))).toBeVisible();
    await expect(element(by.text('User entered · Unreviewed'))).toBeVisible();

    await element(by.text('Details and correction history')).tap();
    await expectVisible('manual-history-detail');
    await element(by.id('manual-history-correct')).tap();
    await element(by.id('manual-history-title-input')).replaceText('Corrected synthetic history entry');
    await element(by.id('manual-history-details-input')).replaceText(
      'Corrected synthetic details for the manual history simulator test.',
    );
    await element(by.id('manual-history-correction-note-input')).replaceText(
      'Corrected the entry title.',
    );
    await element(by.id('manual-history-correction-note-input')).tapReturnKey();
    await element(by.id('manual-history-date-unknown')).tap();
    await element(by.id('manual-history-effective-date-input')).replaceText('2024-04-03');
    await element(by.id('manual-history-effective-date-input')).tapReturnKey();
    await element(by.id('manual-history-save')).tap();

    await expectVisible('manual-history-correction-history');
    await expect(element(by.text('Earlier version'))).toBeVisible();
    await expect(element(by.text('Current version'))).toBeVisible();
    await expectHistoryText('Synthetic history entry');
    await expectHistoryText('Corrected synthetic history entry');
    await expectHistoryText('Correction note: Corrected the entry title.');
    await expectHistoryText('Effective date unknown');
    await expectHistoryText('Effective date: 2024-04-03');
    await expectTwoRecordedVersions();

    await device.terminateApp();
    await device.launchApp({ newInstance: true });
    await expectVisible('welcome-title');
    await openManualHistory();
    await waitFor(element(by.text('Corrected synthetic history entry')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.text('User entered · Unreviewed'))).toBeVisible();
    await element(by.text('Details and correction history')).tap();
    await expectVisible('manual-history-correction-history');
    await expectHistoryText('Synthetic history entry');
    await expectHistoryText('Corrected synthetic history entry');
    await expectHistoryText('Correction note: Corrected the entry title.');
    await expectHistoryText('Effective date unknown');
    await expectHistoryText('Effective date: 2024-04-03');
    await expectTwoRecordedVersions();
    await expectVisible('manual-history-date-detail');
  });

  it('persists a known effective date across an app restart', async () => {
    await device.launchApp();
    await expectVisible('welcome-title');
    await openManualHistory();
    await expectVisible('manual-history-empty');

    await createKnownDateEntry();
    await waitFor(element(by.text('Synthetic dated history entry')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.text('User entered · Unreviewed'))).toBeVisible();
    await expect(element(by.text('Effective date: 2024-02-09'))).toBeVisible();

    await device.terminateApp();
    await device.launchApp({ newInstance: true });
    await expectVisible('welcome-title');
    await openManualHistory();
    await waitFor(element(by.text('Synthetic dated history entry')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.text('User entered · Unreviewed'))).toBeVisible();
    await expect(element(by.text('Effective date: 2024-02-09'))).toBeVisible();
  });
});
