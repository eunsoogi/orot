import { conversationA2UIFrameLimit } from './conversationA2UI';
import { draftA2UISurfaceId } from './conversationA2UIPresentation';
import { fail, keys, object } from './conversationA2UIWireValues';

// Only the exact owned surface and operation may contribute template values.
export function envelope(
  raw: unknown,
  operation: 'createSurface' | 'updateDataModel',
) {
  if (typeof raw !== 'string' || raw.length > conversationA2UIFrameLimit)
    fail();
  const message = object(JSON.parse(raw) as unknown);
  keys(message, ['version', operation]);
  const body = object(message[operation]);
  if (message.version !== '1.0' || body.surfaceId !== draftA2UISurfaceId)
    fail();
  return body;
}

// Each complete replacement targets an existing distinct section exactly once.
export function readReplacements(
  frames: readonly unknown[],
  sections: ReadonlyMap<string, unknown>,
) {
  const replacements = new Map<string, unknown>();
  for (const frame of frames) {
    const update = envelope(frame, 'updateDataModel');
    keys(update, ['surfaceId', 'path', 'value']);
    const path = update.path;
    if (
      typeof path !== 'string' ||
      !sections.has(path) ||
      replacements.has(path)
    )
      fail();
    replacements.set(path, update.value);
  }
  return replacements;
}
