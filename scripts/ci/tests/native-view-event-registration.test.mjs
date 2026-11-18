import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');
function registrations(text) {
  return [
    ...text.matchAll(/RCT_EXPORT_VIEW_PROPERTY\((\w+),\s*RCT(Direct|Bubbling)EventBlock\)/g),
  ].map(([, name, kind]) => ({ name: name.replace(/^on/, 'top'), kind }));
}
function conflicts(events) {
  const types = new Map();
  return events.filter((event) => {
    const prior = types.get(event.name);
    types.set(event.name, event.kind);
    return prior && prior !== event.kind;
  });
}

test('native view event names never mix direct and bubbling registration', () => {
  // RN's legacy view config registry normalizes onX to topX across components.
  const events = registrations(source('apps/mobile/ios/Navigation/NavigationGlassViewManager.m'));
  assert.ok(events.length >= 8);
  assert.deepEqual(conflicts(events), []);
  assert.deepEqual(
    conflicts(
      registrations(
        'RCT_EXPORT_VIEW_PROPERTY(onAction, RCTBubblingEventBlock)\nRCT_EXPORT_VIEW_PROPERTY(onAction, RCTDirectEventBlock)',
      ),
    ),
    [{ name: 'topAction', kind: 'Direct' }],
  );
});

test('GlassIconButton direct event is aligned across Swift, export and JS without changing navigation bubbling', () => {
  const bridge = source('apps/mobile/ios/Navigation/NavigationGlassViewManager.m');
  assert.match(bridge, /RCT_EXPORT_VIEW_PROPERTY\(onGlassIconPress, RCTDirectEventBlock\)/);
  assert.match(bridge, /RCT_EXPORT_VIEW_PROPERTY\(onAction, RCTBubblingEventBlock\)/);
  const swift = source('apps/mobile/ios/Navigation/GlassIconButton.swift');
  assert.match(swift, /@objc var onGlassIconPress: RCTDirectEventBlock\?/);
  assert.match(swift, /onGlassIconPress\?\(\[:\]\)/);
  assert.doesNotMatch(swift, /\bonAction\b/);
  const component = source('apps/mobile/src/layout/GlassIconButton.tsx');
  assert.match(component, /onGlassIconPress=\{invoke\}/);
  assert.doesNotMatch(component, /\bonAction\b/);
});
