/* global by, device, element, expect, waitFor */

async function frameFor(testID) {
  const attributes = await element(by.id(testID)).getAttributes();
  if (!attributes.frame) {
    throw new Error(`Detox did not return a frame for ${testID}.`);
  }
  return attributes.frame;
}

async function expectScrollInsideSafeRoot() {
  const root = await frameFor('safe-area-root');
  const scroll = await frameFor('safe-area-scroll');

  // Native frames prove that content begins below the status area and ends above Home.
  expect(scroll.y).toBeGreaterThan(root.y);
  expect(scroll.y + scroll.height).toBeLessThan(root.y + root.height);
}

describe('safe area routes on iOS Simulator', () => {
  beforeEach(async () => {
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });
  });

  it('keeps the welcome viewport inside the system insets and reaches trailing actions', async () => {
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await expectScrollInsideSafeRoot();

    const scroll = element(by.id('safe-area-scroll'));
    await scroll.scrollTo('bottom');
    await expect(element(by.id('open-recording'))).toBeVisible();
    await scroll.scrollTo('top');

    await element(by.id('open-common-observations')).tap();
    await waitFor(element(by.id('common-observations-import')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('safe-area-scroll')).scrollTo('bottom');
    await expect(element(by.id('common-observations-import'))).toBeVisible();
  });

  it('preserves the recording screen inset root and existing inner scrolling', async () => {
    await waitFor(element(by.id('open-recording')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('open-recording')).tap();
    await waitFor(element(by.id('recording-start')))
      .toBeVisible()
      .withTimeout(30000);

    await expect(element(by.id('safe-area-root'))).toBeVisible();
    await expect(element(by.id('safe-area-scroll'))).not.toExist();
    await expect(element(by.id('recording-start'))).toBeVisible();
  });
});
