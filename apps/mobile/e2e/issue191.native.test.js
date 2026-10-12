/* global by, device, element, waitFor */
const { expect: jestExpect } = require('@jest/globals');
const { tapNativeNavigationAction } = require('./smokeHelpers');

describe('issue 191 shipping screens with synthetic SQLCipher records', () => {
  it('records the medication conversation baseline', async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxEnableSynchronization: 0 },
    });
    await device.disableSynchronization();
    await waitFor(element(by.id('navigation-tab-ai')))
      .toExist()
      .withTimeout(30000);
    await tapNativeNavigationAction('navigation-tab-ai');
    await waitFor(element(by.id('ai-feature-rag-conversation')))
      .toBeVisible()
      .withTimeout(10000);
    await waitFor(element(by.id('ai-feature-rag-conversation')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('ai-feature-rag-conversation')).tap();
    const input = element(by.id('rag-conversation-input'));
    await waitFor(input).toBeVisible().withTimeout(10000);
    console.log(
      'ISSUE191_COMPOSER ' + JSON.stringify(await input.getAttributes()),
    );
    await device.takeScreenshot('issue191-conversation-empty');
    await input.replaceText('내가 먹는 약은?');
    // Unsynchronized execution must wait for the keyboard's native movement before tapping.
    await new Promise(resolve => setTimeout(resolve, 1000));
    const start = Date.now();
    await element(by.id('rag-conversation-send')).tap();
    await waitFor(element(by.text('내가 먹는 약은?')))
      .toBeVisible()
      .withTimeout(10000);
    await waitFor(element(by.id('rag-conversation-send')))
      .toExist()
      .withTimeout(180000);
    console.log('ISSUE191_CONVERSATION_MS ' + (Date.now() - start));
    console.log(
      'ISSUE191_CONVERSATION_UI ' +
        (await device.generateViewHierarchyXml(true)),
    );
    const hierarchy = await device.generateViewHierarchyXml(true);
    jestExpect(hierarchy).toContain('아세트아미노펜');
    jestExpect(hierarchy).not.toMatch(
      /dose_event|health_observation|\be[0-9]+\b/,
    );
    jestExpect(hierarchy).toContain('원문 근거 열기');
    // The same fixture contains a future consultation plan, never an ongoing encounter.
    jestExpect(hierarchy).not.toMatch(/상담 중|진료를 받았|진료받았/);
    jestExpect(hierarchy).toContain('원문 기록 당시');
    await device.takeScreenshot('issue191-conversation-result');
  });

  it('records disease and visit-question latency and cancellation', async () => {
    for (const kind of ['disease-hypotheses', 'visit-questions']) {
      await device.launchApp({
        newInstance: true,
        launchArgs: { detoxEnableSynchronization: 0 },
      });
      await device.disableSynchronization();
      await waitFor(element(by.id('navigation-tab-ai')))
        .toExist()
        .withTimeout(30000);
      await tapNativeNavigationAction('navigation-tab-ai');
      await waitFor(element(by.id(`ai-feature-${kind}`)))
        .toBeVisible()
        .withTimeout(10000);
      await element(by.id(`ai-feature-${kind}`)).tap();
      const generateId =
        kind === 'visit-questions'
          ? 'next-visit-generate'
          : 'disease-hypotheses-generate';
      await waitFor(element(by.id(generateId)))
        .toExist()
        .withTimeout(30000);
      await device.takeScreenshot(`issue191-${kind}-before`);
      const started = Date.now();
      if (kind === 'visit-questions')
        await tapNativeNavigationAction(generateId);
      else await element(by.id(generateId)).tap();
      const loadingId =
        kind === 'visit-questions'
          ? 'next-visit-generation-loading'
          : 'disease-hypotheses-loading';
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        await waitFor(element(by.id(loadingId)))
          .not.toExist()
          .withTimeout(180000);
        console.log(`ISSUE191_${kind}_MS ` + (Date.now() - started));
      } catch {
        console.log(`ISSUE191_${kind}_TIMEOUT_MS ` + (Date.now() - started));
      }
      console.log(
        `ISSUE191_${kind}_UI ` + (await device.generateViewHierarchyXml(true)),
      );
      if (kind === 'visit-questions') {
        // A quick clarification/error is not successful question generation.
        const hierarchy = await device.generateViewHierarchyXml(true);
        jestExpect(hierarchy).toContain('next-visit-review-list');
        jestExpect(hierarchy).toContain('질문 편집');
        jestExpect(hierarchy).toContain('근거');
      }
      await device.takeScreenshot(`issue191-${kind}-result`);
    }
  });
  (process.env.OROT_ISSUE191_EMPTY === 'enabled' ? it : it.skip)(
    'reports genuinely insufficient data from an empty SQLCipher library',
    async () => {
      await device.launchApp({
        newInstance: true,
        launchArgs: {
          detoxEnableSynchronization: 0,
          OROT_ISSUE191_EMPTY: 'enabled',
        },
      });
      await device.disableSynchronization();
      await waitFor(element(by.id('navigation-tab-ai')))
        .toExist()
        .withTimeout(30000);
      await tapNativeNavigationAction('navigation-tab-ai');
      await waitFor(element(by.id('ai-feature-rag-conversation')))
        .toBeVisible()
        .withTimeout(10000);
      await element(by.id('ai-feature-rag-conversation')).tap();
      const input = element(by.id('rag-conversation-input'));
      await waitFor(input).toBeVisible().withTimeout(5000);
      await input.replaceText('내가 먹는 약은?');
      await new Promise(resolve => setTimeout(resolve, 700));
      await element(by.id('rag-conversation-send')).tap();
      await waitFor(element(by.id('rag-conversation-send')))
        .toExist()
        .withTimeout(90000);
      console.log(
        'ISSUE191_EMPTY_UI ' + (await device.generateViewHierarchyXml(true)),
      );
      const emptyHierarchy = await device.generateViewHierarchyXml(true);
      jestExpect(emptyHierarchy).not.toContain('아세트아미노펜');
      jestExpect(emptyHierarchy).toMatch(/근거가 부족|저장된 근거를 찾지 못/);
      await device.takeScreenshot('issue191-empty-library-result');
    },
  );
});
