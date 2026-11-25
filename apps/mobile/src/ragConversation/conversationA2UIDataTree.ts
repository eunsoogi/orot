import { fail, type Data } from './conversationA2UIWire';

export function updateData(
  original: Data,
  path: readonly string[],
  value: string | Data | null,
): Data {
  if (!path.length) {
    if (typeof value === 'string') fail();
    return value ?? Object.create(null);
  }
  const data: Data = Object.assign(Object.create(null), original);
  const [segment, ...rest] = path;
  const previous = data[segment];
  if (rest.length) {
    if (typeof previous === 'string') fail();
    data[segment] = updateData(previous ?? Object.create(null), rest, value);
  } else if (value === null) {
    delete data[segment];
  } else {
    data[segment] = value;
  }
  return data;
}

export function resolve(
  data: Data,
  path: readonly string[],
): string | undefined {
  let current: Data | string | undefined = data;
  for (const segment of path) {
    if (typeof current === 'string') fail();
    current = current?.[segment];
  }
  if (current !== undefined && typeof current !== 'string') fail();
  return current;
}
