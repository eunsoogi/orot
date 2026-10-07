/* global by, element, waitFor */

/**
 * Scrolls the synthetic provider list and clears the debug warning toast if it
 * obscures the confirmation control.
 */
module.exports = async function scrollToConfirmation(selectionScreen, device) {
  await selectionScreen.scrollTo('bottom', 0.5, 0.7);

  const warningText = 'Open debugger to view warnings.';
  const warning = element(by.text(warningText));
  try {
    await waitFor(warning).toExist().withTimeout(1000);
  } catch (error) {
    // Only the exact optional LogBox lookup timeout is safe to ignore.
    const warningIsAbsent =
      error?.name === 'DetoxRuntimeError' &&
      error.message.includes(
        `Timed out while waiting for expectation: TOEXIST WITH MATCHER(text == “${warningText}”) TIMEOUT(1s)`,
      );
    if (warningIsAbsent) return;
    throw error;
  }

  const { frame, visible } = await warning.getAttributes();
  if (!visible) return;

  // LogBox's dismiss control is 15 points to the right of the warning text.
  // XCUITest parses Detox's screen coordinates as integers, so round frame values.
  await device.tap({
    x: Math.round(frame.x + frame.width + 15),
    y: Math.round(frame.y + frame.height / 2),
  });
  await waitFor(warning).not.toExist().withTimeout(10000);
};
