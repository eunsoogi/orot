import { canonicalConversationDraftDate } from './canonicalConversationDraftDate';
import type { ComposedControl } from './conversationA2UIComposedControlState';
import { fail, keys } from './conversationA2UIWireValues';

const dateTime =
  /^([0-9]{4}-[0-9]{2}-[0-9]{2})T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,3})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/u;

function bound(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return fail();
  const parts = dateTime.exec(value);
  if (
    !parts ||
    parts[0] !== value ||
    !canonicalConversationDraftDate(parts[1]) ||
    value.endsWith('-00:00')
  )
    return fail();
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : fail();
}

export function combinedDateTimeBounds(value: Record<string, unknown>) {
  const min = bound(value.min);
  const max = bound(value.max);
  if (min !== undefined && max !== undefined && min > max) fail();
  return {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

export function dateTimeControlFor(
  value: Record<string, unknown>,
  base: string[],
  caption: string,
  timeControls: boolean | 'combined',
): ComposedControl {
  if (
    timeControls &&
    value.enableTime === true &&
    (value.enableDate === undefined || value.enableDate === false)
  ) {
    keys(value, [...base, 'enableDate', 'enableTime']);
    return { kind: 'time', label: caption };
  }
  keys(value, [...base, 'enableDate', 'enableTime', 'min', 'max']);
  if (
    timeControls === 'combined' &&
    value.enableDate === true &&
    value.enableTime === true
  )
    return {
      kind: 'datetime',
      label: caption,
      ...combinedDateTimeBounds(value),
    };
  if (
    value.enableDate !== true ||
    (value.enableTime !== undefined && value.enableTime !== false)
  )
    fail();
  const min = canonicalConversationDraftDate(value.min);
  const max = canonicalConversationDraftDate(value.max);
  if (!min || !max || min >= max) fail();
  return { kind: 'date', label: caption, min, max };
}
