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
  const toolbarMatches = element(by.id('navigation-native-toolbar'));
  const attributes = await action.getAttributes();
  const toolbarAttributes = await toolbarMatches.getAttributes();
  const hierarchyXml = await device.generateViewHierarchyXml(true);
  const actionCandidates = attributes.elements ?? [attributes];
  const toolbarCandidates = toolbarAttributes.elements ?? [toolbarAttributes];
  const actionNode = hierarchyXml
    .split('\n')
    .find(
      line =>
        line.includes(`id="${testID}"`) &&
        line.includes('visibility="visible"'),
    );
  const contains = (outer, inner) =>
    inner &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1;
  // Retained native stacks expose hidden parent bars with the same ID; select the visible bar containing this action.
  const activeToolbar = toolbarCandidates
    .map((candidate, index) => ({ candidate, index }))
    .find(
      ({ candidate }) =>
        candidate.visible &&
        candidate.hittable &&
        candidate.frame &&
        actionCandidates.some(item => contains(candidate.frame, item.frame)),
    );
  const toolbarFrame = activeToolbar?.candidate.frame;
  const frame = actionCandidates.find(
    item => toolbarFrame && contains(toolbarFrame, item.frame),
  )?.frame;

  // iOS 27 reports visible native toolbar children as hidden in XCUI attributes; verify the UIKit node and parent instead.
  if (
    !actionNode ||
    !activeToolbar ||
    !frame ||
    frame.width + 0.001 < 44 ||
    frame.height + 0.001 < 44 ||
    !toolbarFrame
  ) {
    throw new Error(
      `Native navigation action ${testID} must be visible in UIKit, inside its active toolbar, and at least 44 points in both dimensions: ${JSON.stringify({ attributes, toolbarAttributes, actionNode })}`,
    );
  }

  return {
    toolbar: toolbarMatches.atIndex(activeToolbar.index),
    frame,
    toolbarFrame,
  };
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
