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

/** Opens a native root tab and waits for any route marker that proves its content is active. */
async function openRootTab(tabId, screenID) {
  await tapNativeNavigationAction(`navigation-tab-${tabId}`);
  const screenIDs = Array.isArray(screenID) ? screenID : [screenID];
  if (screenIDs.length > 1) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const hierarchyXml = await device.generateViewHierarchyXml(true);
      if (
        hierarchyXml
          .split('\n')
          .some(
            line =>
              screenIDs.some(screenId => line.includes(`id="${screenId}"`)) &&
              line.includes('visibility="visible"'),
          )
      ) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(
      `None of the native route markers became visible: ${screenIDs.join(', ')}.`,
    );
  }

  await waitFor(element(by.id(screenIDs[0])))
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
    hierarchyXml,
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

/** Fires root-tab taps without waiting for route content so interrupted motion is exercised. */
async function tapRapidNativeNavigationActions(testIDs) {
  const targets = [];
  for (const testID of testIDs) {
    const { toolbar, frame, toolbarFrame } =
      await expectNativeNavigationAction(testID);
    targets.push({
      toolbar,
      x: frame.x + frame.width / 2 - toolbarFrame.x,
      y: frame.y + frame.height / 2 - toolbarFrame.y,
    });
  }

  // Skip Detox idle waits between taps so an in-flight transition can be interrupted.
  await device.disableSynchronization();
  try {
    for (const target of targets) {
      await target.toolbar.tap({ x: target.x, y: target.y });
    }
  } finally {
    await device.enableSynchronization();
  }
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

async function scrollRouteToBottom() {
  // Scroll the route viewport independently of its fixed bottom action bar.
  await element(by.id('navigation-route-scroll')).scrollTo('bottom', 0.5, 0.5);
}

module.exports = {
  expectNativeNavigationAction,
  confirmUnsavedLeave,
  openRootTab,
  openFeatureAndReturn,
  scrollHomeActionIntoView,
  scrollRouteToBottom,
  tapRapidNativeNavigationActions,
  tapNativeNavigationAction,
};
