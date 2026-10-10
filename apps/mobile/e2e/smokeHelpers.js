/* global by, device, element, waitFor */

/** Exercise a real route and confirm only when its state guard reports local edits. */
async function openFeatureAndReturn(
  entryId,
  screenId,
  exerciseFeature,
  confirmUnsaved = false,
) {
  const aiScreen = element(by.id('ai-features-screen'));
  await aiScreen.scrollTo('top');
  await waitFor(element(by.id(entryId)))
    .toBeVisible()
    .whileElement(by.id('ai-features-screen'))
    .scroll(100, 'down', 0.5, 0.35);
  await element(by.id(entryId)).tap();
  await waitFor(element(by.id(screenId)))
    .toBeVisible()
    .withTimeout(30000);
  if (exerciseFeature) await exerciseFeature();
  // Integrated feature routes expose Back through the shared native toolbar.
  await tapNativeNavigationAction('navigation-back');
  if (confirmUnsaved) await confirmUnsavedLeave();
  await waitFor(element(by.id('ai-features-screen')))
    .toBeVisible()
    .withTimeout(30000);
}

async function confirmUnsavedLeave() {
  await waitFor(element(by.text('내용 버리고 나가기')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.text('내용 버리고 나가기')).tap();
}

/** Opens a native root tab and waits for its first real route marker. */
async function openRootTab(tabId, screenID) {
  await tapNativeNavigationAction(`navigation-tab-${tabId}`);
  await waitFor(element(by.id(screenID)))
    .toBeVisible()
    .withTimeout(30000);
}

async function expectNativeNavigationAction(testID) {
  const action = element(by.id(testID));
  const toolbar = element(by.id('navigation-native-toolbar'));
  const attributes = await action.getAttributes();
  const toolbarAttributes = await toolbar.getAttributes();
  const hierarchyXml = await device.generateViewHierarchyXml(true);
  const { frame } = attributes;
  const toolbarFrame = toolbarAttributes.frame;
  const actionNode = hierarchyXml
    .split('\n')
    .find(line => line.includes(`id="${testID}"`));
  const actionVisibleInHierarchy = actionNode?.includes('visibility="visible"');

  // iOS 27 reports visible native toolbar children as hidden in XCUI attributes; verify the UIKit node and parent instead.
  if (
    !actionVisibleInHierarchy ||
    !toolbarAttributes.visible ||
    !toolbarAttributes.hittable ||
    !frame ||
    frame.width + 0.001 < 44 ||
    frame.height + 0.001 < 44 ||
    !toolbarFrame
  ) {
    throw new Error(
      `Native navigation action ${testID} must be visible in UIKit, inside a visible and hittable toolbar, and at least 44 points in both dimensions: ${JSON.stringify({ attributes, toolbarAttributes, actionNode })}`,
    );
  }

  if (
    frame.x < toolbarFrame.x ||
    frame.y < toolbarFrame.y ||
    frame.x + frame.width > toolbarFrame.x + toolbarFrame.width + 1 ||
    frame.y + frame.height > toolbarFrame.y + toolbarFrame.height + 1
  ) {
    throw new Error(
      `Native navigation action ${testID} extends outside its toolbar.`,
    );
  }
  return { toolbar, frame, toolbarFrame };
}

async function tapNativeNavigationAction(testID) {
  const { toolbar, frame, toolbarFrame } =
    await expectNativeNavigationAction(testID);

  // Tap the measured button center through the toolbar because XCUI misreports the child's activation point.
  await toolbar.tap({
    x: frame.x + frame.width / 2 - toolbarFrame.x,
    y: frame.y + frame.height / 2 - toolbarFrame.y,
  });
}

async function scrollHomeActionIntoView(testID) {
  const scrollID = 'navigation-route-scroll';
  const target = element(by.id(testID));
  await element(by.id(scrollID)).scrollTo('top');
  // Home action positions vary with content size, so scroll only until the requested row appears.
  await waitFor(target)
    .toBeVisible()
    .whileElement(by.id(scrollID))
    .scroll(100, 'down', 0.5, 0.35);
}

module.exports = {
  expectNativeNavigationAction,
  confirmUnsavedLeave,
  openRootTab,
  openFeatureAndReturn,
  scrollHomeActionIntoView,
  tapNativeNavigationAction,
};
