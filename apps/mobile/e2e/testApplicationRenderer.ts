let renderer: (() => void) | null = null;

/** The app-hosted test root registers one renderer; domain tests keep the application unmounted until requested. */
export function registerTestApplicationRenderer(
  callback: () => void,
): () => void {
  if (renderer)
    throw new Error('A test application renderer is already registered');
  renderer = callback;
  return () => {
    if (renderer === callback) renderer = null;
  };
}

export function renderApplicationForTest(): { requested: true } {
  if (!renderer) throw new Error('The app-hosted test renderer is unavailable');
  renderer();
  return { requested: true };
}
