import { conversationA2UIFrameLimit } from './conversationA2UI';
import {
  conversationA2UIProse,
  draftA2UISurfaceId,
} from './conversationA2UIPresentation';
import { displayText, fail, keys, object } from './conversationA2UIWireValues';

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

const maxItems = 12;
export function readRepeatedRows(raw: unknown, fields: ReadonlySet<string>) {
  if (!Array.isArray(raw) || !raw.length || raw.length > maxItems) fail();
  return (raw as unknown[]).map(value => {
    const row = object(value);
    if (Object.keys(row).length !== fields.size) fail();
    const accepted = new Map<string, string>();
    for (const field of fields) {
      if (!Object.hasOwn(row, field)) fail();
      const text = displayText(row[field]);
      // One field stands for one accepted paragraph. The exact final answer
      // is still checked against the fully materialized graph downstream.
      if (conversationA2UIProse(text)?.length !== 1) fail();
      accepted.set(field, text);
    }
    return accepted;
  });
}
