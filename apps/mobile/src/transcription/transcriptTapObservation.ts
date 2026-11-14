type TapEvent =
  | 'editor-touch-start'
  | 'editor-touch-end'
  | 'input-blur'
  | 'save-press'
  | 'save-enter'
  | 'save-complete'
  | 'save-failed'
  | 'scroll-grant'
  | 'scroll-release';
let observer: ((event: TapEvent) => void) | undefined;

/** Only the synthetic native probe installs this sink. Never collect editor text or change event handling. */
export function registerTranscriptTapObserver(next: (event: TapEvent) => void) {
  observer = next;
  return () => {
    if (observer === next) observer = undefined;
  };
}
export function observeTranscriptTap(event: TapEvent) {
  try {
    observer?.(event);
  } catch {
    /* Diagnostics cannot affect editing or responder delivery. */
  }
}
