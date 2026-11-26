import { captureDirectPhotoGroup } from '../src/direct-photo-group';

const first = Buffer.from([255, 216, 255, 1, 255, 217]).toString('base64');
const second = Buffer.from([255, 216, 255, 2, 255, 217]).toString('base64');

test('captures the immutable original order without silently dropping repeated selections', () => {
  const selected = [second, first, second];
  const approved = captureDirectPhotoGroup(selected);
  selected.reverse();
  selected.splice(0, selected.length, first);
  expect(approved).toEqual([second, first, second]);
  expect(Object.isFrozen(approved)).toBe(true);
  expect(captureDirectPhotoGroup([first])).toEqual([first]);
});

test('rejects the complete selection if any item is missing, invalid or too large', () => {
  expect(captureDirectPhotoGroup([])).toBeUndefined();
  expect(captureDirectPhotoGroup([first, '', second])).toBeUndefined();
  const incomplete = new Array<string>(3);
  incomplete[0] = first;
  incomplete[2] = second;
  expect(captureDirectPhotoGroup(incomplete)).toBeUndefined();
  expect(captureDirectPhotoGroup([first, second, first, second])).toBeUndefined();
  const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 255);
  oversized[1] = 216;
  expect(captureDirectPhotoGroup([first, oversized.toString('base64')])).toBeUndefined();
});

test('counts decoded bytes across the entire selection, including base64 padding', () => {
  const bytes = Buffer.alloc(2 * 1024 * 1024, 255);
  bytes[1] = 216;
  const full = bytes.toString('base64');
  expect(captureDirectPhotoGroup([full, full])).toHaveLength(2);
  expect(captureDirectPhotoGroup([full, full, second])).toBeUndefined();
});
