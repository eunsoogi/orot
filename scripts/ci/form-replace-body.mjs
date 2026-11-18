import assert from 'node:assert/strict';

/** Extract the unchanged replace/timing methods, never a comment-delimited or truncated enum. */
export function formReplaceBody(source) {
  const start = source.indexOf('    static func replace(');
  const end = source.indexOf('    private static func navigationControlFrames(', start);
  assert.ok(start >= 0 && end > start, 'The form replace method boundaries must exist in order');
  return source.slice(start, end);
}
