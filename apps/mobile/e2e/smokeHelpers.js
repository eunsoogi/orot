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

/** Requires an actual visible, hittable UIKit button inside the active native surface. */
async function expectNativeNavigationAction(testID) {
  const action = element(by.id(testID));
  const toolbarMatches = element(by.id('navigation-bar-native-surface'));
  const attributes = await action.getAttributes();
  const toolbarAttributes = await toolbarMatches.getAttributes();
  const hierarchyXml = await device.generateViewHierarchyXml(true);
  const actions = attributes.elements ?? [attributes];
  const surfaces = toolbarAttributes.elements ?? [toolbarAttributes];
  const contains = (outer, inner) =>
    inner &&
    outer &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1;
  const actionIndex = actions.findIndex(
    item =>
      item.visible &&
      item.hittable &&
      item.frame?.width >= 44 &&
      item.frame?.height >= 44 &&
      surfaces.some(surface => contains(surface.frame, item.frame)),
  );
  const frame = actions[actionIndex]?.frame;
  const surfaceIndex = surfaces.findIndex(surface =>
    contains(surface.frame, frame),
  );
  const actionNode = hierarchyXml
    .split('\n')
    .find(
      line =>
        line.includes(`id="${testID}"`) &&
        line.includes('visibility="visible"'),
    );
  if (actionIndex < 0 || surfaceIndex < 0 || !actionNode) {
    throw new Error(
      `Native navigation action ${testID} must be visible, hittable, at least 44pt, and contained by its surface: ${JSON.stringify({ attributes, toolbarAttributes })}`,
    );
  }
  return {
    action: action.atIndex(actionIndex),
    toolbar: toolbarMatches.atIndex(surfaceIndex),
    frame,
    toolbarFrame: surfaces[surfaceIndex].frame,
    hierarchyXml,
  };
}

async function tapNativeNavigationAction(testID) {
  const { action } = await expectNativeNavigationAction(testID);
  await action.tap();
}

/** Sends root-tab taps without idle waits so the native indicator is interrupted while moving. */
async function tapRapidNativeNavigationActions(testIDs) {
  const targets = [];
  for (const testID of testIDs) {
    targets.push((await expectNativeNavigationAction(testID)).action);
  }
  await device.disableSynchronization();
  try {
    for (const action of targets) await action.tap();
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
