/* global by, element, waitFor */

/** Dismisses only the React Native debug toast; product alerts and test failures stay intact. */
module.exports = async function dismissProbeDebugToast(device) {
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
  await device.tap({
    x: Math.round(frame.x + frame.width + 15),
    y: Math.round(frame.y + frame.height / 2),
  });
  await waitFor(warning).not.toExist().withTimeout(10000);
};
