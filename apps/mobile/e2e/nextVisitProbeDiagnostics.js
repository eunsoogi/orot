/* global by, element, waitFor */

/** Dismisses only the React Native debug toast; product alerts and test failures stay intact. */
module.exports = async function dismissProbeDebugToast() {
  const warningText = 'Open debugger to view warnings.';
  const warning = element(by.text(warningText));
  try {
    await waitFor(warning).toExist().withTimeout(1000);
  } catch (error) {
    const absent =
      error?.name === 'DetoxRuntimeError' &&
      error.message.includes(
        `Timed out while waiting for expectation: TOEXIST WITH MATCHER(text == “${warningText}”) TIMEOUT(1s)`,
      );
    if (absent) return;
    throw error;
  }
  const { frame, visible } = await warning.getAttributes();
  if (!visible) return;
  // The close button sits outside the text. Use the observed Fabric root as the
  // tap surface; device.tap starts a separate XCTest runner that can fail on iOS 27 AX.
  const root = element(
    by.type('RCTRootComponentView').withDescendant(by.text(warningText)),
  );
  const { frame: rootFrame } = await root.getAttributes();
  await root.tap({
    x: Math.round(frame.x + frame.width + 15 - rootFrame.x),
    y: Math.round(frame.y + frame.height / 2 - rootFrame.y),
  });
  await waitFor(warning).not.toExist().withTimeout(10000);
};
