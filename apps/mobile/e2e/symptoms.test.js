/* global by, device, element, expect, jest, waitFor */

jest.setTimeout(180000);

async function expectText(text) {
  await waitFor(element(by.text(text)))
    .toBeVisible()
    .withTimeout(30000);
}

async function expectId(id) {
  await waitFor(element(by.id(id)))
    .toBeVisible()
    .withTimeout(30000);
}

async function expectEntryStatus(status) {
  await waitFor(element(by.id(/^symptom-.*-status$/)))
    .toHaveText(status)
    .withTimeout(30000);
}

async function expectDescription(description) {
  const accessibleText = description.replace(/\s+/g, ' ');
  const entry = element(by.id(/^symptom-.*-description$/));
  await waitFor(entry).toBeVisible().withTimeout(30000);
  const attributes = await entry.getAttributes();
  const matches = 'elements' in attributes ? attributes.elements : [attributes];
  const content = matches
    .flatMap(({ label, text }) => [label, text])
    .filter(value => typeof value === 'string')
    .map(value => value.replace(/\s+/g, ' '));
  if (!content.includes(accessibleText)) {
    throw new Error(`Expected symptom text, received: ${content.join(', ')}`);
  }
}

async function scrollTo(edge) {
  await element(by.id('symptoms-scroll')).scrollTo(edge);
}

async function openSymptoms() {
  await element(by.id('symptoms-open')).tap();
}

describe('symptom journal', () => {
  beforeAll(async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
  });

  it('creates, edits, resolves, filters, and preserves a user-entered entry', async () => {
    await device.launchApp();
    await expectText('Orot workspace ready');
    await openSymptoms();
    await expectId('symptoms-empty');

    await scrollTo('bottom');
    await element(by.id('symptom-add')).tap();
    await scrollTo('bottom');
    await element(by.id('symptom-description')).replaceText(
      'Intermittent headache',
    );
    await element(by.id('symptom-onset-date')).replaceText('2025-04-02');
    await element(by.id('symptom-onset-time')).replaceText('09:30');
    await element(by.id('symptom-onset-time')).tapReturnKey();
    await element(by.id('symptom-status-active')).tap();
    await scrollTo('bottom');
    await element(by.id('symptom-severity')).replaceText('6');
    await element(by.id('symptom-keyboard-save-severity')).tap();
    await expectText('Intermittent headache');
    await expectText('Your severity: 6/10');
    await expectText('User-entered · not clinician-confirmed');
    await expectEntryStatus('Active');

    await scrollTo('bottom');
    await element(by.text('Edit symptom')).tap();
    await scrollTo('bottom');
    await element(by.id('symptom-description')).replaceText(
      'Mild headache after lunch\nusually in the afternoon',
    );
    await element(by.id('symptom-keyboard-save-description')).tap();
    await expectDescription(
      'Mild headache after lunch\nusually in the afternoon',
    );
    await expectText('2025-04-02 at 09:30 (local time)');
    await element(by.id('symptoms-scroll')).swipe('down', 'fast', 0.55);
    await expectId('symptom-filter-active');

    await element(by.id('symptom-filter-active')).tap();
    await expectDescription(
      'Mild headache after lunch\nusually in the afternoon',
    );
    await element(by.id('symptom-filter-from-date')).replaceText('2025-04-02');
    await element(by.id('symptom-filter-from-time')).replaceText('09:30');
    await element(by.id('symptom-filter-through-date')).replaceText(
      '2025-04-02',
    );
    await element(by.id('symptom-filter-through-time')).replaceText('09:30');
    await element(by.id('symptom-filter-keyboard-apply-through-time')).tap();
    await expectDescription(
      'Mild headache after lunch\nusually in the afternoon',
    );

    await scrollTo('bottom');
    await element(by.text('Mark resolved')).tap();
    await expect(element(by.id(/^symptom-.*-description$/))).not.toExist();
    await element(by.id('symptom-filter-resolved')).tap();
    await expectDescription(
      'Mild headache after lunch\nusually in the afternoon',
    );
    await expectEntryStatus('Resolved');

    await device.terminateApp();
    await device.launchApp({ newInstance: true });
    await expectText('Orot workspace ready');
    await openSymptoms();
    await expectDescription(
      'Mild headache after lunch\nusually in the afternoon',
    );
    await expectEntryStatus('Resolved');
    await expectText('User-entered · not clinician-confirmed');
  });
});
