/* global by, device, element, waitFor */
const { tapNativeNavigationAction } = require('./smokeHelpers');

describe('issue 191 native navigation and cancellation', () => {
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
  it('leaves an active conversation with Back and ignores its late result', async () => {
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
    await element(by.id('ai-feature-rag-conversation')).tap();
    const input = element(by.id('rag-conversation-input'));
    await waitFor(input).toBeVisible().withTimeout(5000);
    await input.replaceText('내가 먹는 약은?');
    await new Promise(resolve => setTimeout(resolve, 700));
    await element(by.id('rag-conversation-send')).tap();
    await waitFor(element(by.id('rag-conversation-cancel')))
      .toExist()
      .withTimeout(5000);
    await new Promise(resolve => setTimeout(resolve, 700));
    const started = Date.now();
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.text('버리고 작업 중단 후 나가기')))
      .toExist()
      .withTimeout(3000);
    console.log('ISSUE191_BACK_CONFIRM_MS ' + (Date.now() - started));
    await element(by.text('버리고 작업 중단 후 나가기')).tap();
    await waitFor(element(by.id('ai-feature-rag-conversation')))
      .toBeVisible()
      .withTimeout(5000);
    await new Promise(resolve => setTimeout(resolve, 12000));
    await waitFor(element(by.id('ai-feature-rag-conversation')))
      .toBeVisible()
      .withTimeout(3000);
    await device.takeScreenshot('issue191-back-after-late-result');
  });
});
