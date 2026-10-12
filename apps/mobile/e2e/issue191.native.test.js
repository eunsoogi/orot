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
      await device.takeScreenshot(`issue191-${kind}-result`);
    }
  });
  it('keeps cancellation, keyboard, Back and Home responsive during generation', async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxEnableSynchronization: 0 },
    });
    await device.disableSynchronization();
    await waitFor(element(by.id('navigation-tab-ai')))
      .toExist()
      .withTimeout(30000);
    await tapNativeNavigationAction('navigation-tab-ai');
    await waitFor(element(by.id('ai-feature-visit-questions')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('ai-feature-visit-questions')).tap();
    await waitFor(element(by.id('next-visit-generate')))
      .toExist()
      .withTimeout(30000);
    await tapNativeNavigationAction('next-visit-generate');
    await waitFor(element(by.id('next-visit-generation-cancel')))
      .toExist()
      .withTimeout(10000);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const cancelStart = Date.now();
    await tapNativeNavigationAction('next-visit-generation-cancel');
    await waitFor(element(by.id('next-visit-generate')))
      .toExist()
      .withTimeout(3000);
    console.log('ISSUE191_CANCEL_MS ' + (Date.now() - cancelStart));
    await device.takeScreenshot('issue191-visit-cancelled');
    await new Promise(resolve => setTimeout(resolve, 12000));
    await waitFor(element(by.id('next-visit-generate')))
      .toExist()
      .withTimeout(3000);
    // Reuse the same mounted screen after cancellation; a second request must start.
    await tapNativeNavigationAction('next-visit-generate');
    await waitFor(element(by.id('next-visit-generation-cancel')))
      .toExist()
      .withTimeout(5000);
    // UIKit animates the replacement toolbar item before its measurable frame settles.
    await new Promise(resolve => setTimeout(resolve, 700));
    await tapNativeNavigationAction('next-visit-generation-cancel');
    await waitFor(element(by.id('next-visit-generate')))
      .toExist()
      .withTimeout(3000);
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('ai-feature-rag-conversation')))
      .toBeVisible()
      .withTimeout(5000);
    await waitFor(element(by.id('ai-feature-rag-conversation')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('ai-feature-rag-conversation')).tap();
    const input = element(by.id('rag-conversation-input'));
    await waitFor(input).toBeVisible().withTimeout(5000);
    await input.tap();
    await input.replaceText('첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄\n다섯째 줄');
    await new Promise(resolve => setTimeout(resolve, 700));
    console.log(
      'ISSUE191_MULTILINE_COMPOSER ' +
        JSON.stringify(
          await element(by.id('rag-conversation-composer')).getAttributes(),
        ),
    );
    await device.takeScreenshot('issue191-conversation-keyboard');
    await input.replaceText('내가 먹는 약은?');
    await new Promise(resolve => setTimeout(resolve, 700));
    await element(by.id('rag-conversation-send')).tap();
    await waitFor(element(by.id('rag-conversation-cancel')))
      .toExist()
      .withTimeout(5000);
    // Sending disables editing and dismisses the keyboard; let its native transition settle.
    await new Promise(resolve => setTimeout(resolve, 700));
    const leaveStart = Date.now();
    await tapNativeNavigationAction('navigation-home');
    await waitFor(element(by.text('버리고 작업 중단 후 나가기')))
      .toExist()
      .withTimeout(3000);
    console.log('ISSUE191_HOME_CONFIRM_MS ' + (Date.now() - leaveStart));
    await element(by.text('버리고 작업 중단 후 나가기')).tap();
    await waitFor(element(by.id('navigation-tab-ai')))
      .toExist()
      .withTimeout(5000);
    await device.takeScreenshot('issue191-conversation-left');
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
