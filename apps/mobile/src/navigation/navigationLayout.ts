/** Shared layout measurements keep scrollable content clear of native bottom actions. */
export const NAVIGATION_SURFACE_HEIGHT = 48;
export const ROOT_TAB_SURFACE_HEIGHT = 60;
/** Adds room for labels without shrinking root-tab hit areas below a comfortable height. */
export const ROOT_TAB_TOUCH_TARGET_HEIGHT = 52;
/** Reclaims part of the bottom inset; callers keep the system inset when the keyboard is visible. */
export const ROOT_TAB_SAFE_AREA_TRANSLATION = 10;
export const NAVIGATION_ACTION_TOP_PADDING = 4;
export const NAVIGATION_ACTION_BOTTOM_PADDING = 0;
export const NAVIGATION_CONTENT_GAP = 16;
export const BOTTOM_NAVIGATION_CONTENT_INSET =
  NAVIGATION_SURFACE_HEIGHT +
  NAVIGATION_ACTION_TOP_PADDING +
  NAVIGATION_ACTION_BOTTOM_PADDING;
