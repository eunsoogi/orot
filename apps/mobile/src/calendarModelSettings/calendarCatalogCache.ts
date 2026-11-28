import { calendarDecisionsModel } from '@orot/provider-openai';
import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import type { ModelSettingsServices } from '../agent/execution/ModelSettingsServices';
import { voiceSettingsStore } from '../voiceSettings/voiceSettingsStore';

export const calendarApiProvider = 'openai-api-decisions';
const service = 'com.orot.mobile.calendar-model-catalog.v1';
type Voice = ModelSettingsServices['voice'];
let writes = Promise.resolve();

/** Read an existing credential identity without enrolling legacy keys or exposing credentials. */
export async function calendarCatalogEpoch(voice: Voice) {
  if (
    voice !== voiceSettingsStore ||
    typeof voiceSettingsStore.consentAccountEpoch !== 'function'
  )
    return null;
  try {
    const epoch = await voiceSettingsStore.consentAccountEpoch(false);
    return epoch && /^[0-9a-f]{64}$/.test(epoch) ? epoch : null;
  } catch {
    return null;
  }
}

export function calendarCatalogIds(ids: readonly unknown[]) {
  return ids.includes(calendarDecisionsModel) ? [calendarDecisionsModel] : [];
}

export async function readCalendarCatalog(voice: Voice, revision: number) {
  try {
    const epoch = await calendarCatalogEpoch(voice);
    if (!epoch) return [];
    const value = await getGenericPassword({ service });
    if (
      !value ||
      value.username !== calendarApiProvider ||
      value.password.length > 200
    )
      return [];
    const record = JSON.parse(value.password);
    if (record?.epoch !== epoch || !Array.isArray(record.ids)) return [];
    if (
      (await calendarCatalogEpoch(voice)) !== epoch ||
      !voice.accountRevisionMatches(revision)
    )
      return [];
    return calendarCatalogIds(record.ids);
  } catch {
    return [];
  }
}

/** Cache only durable same-account display IDs. This is not a grant or model readiness. */
export function saveCalendarCatalog(
  voice: Voice,
  epoch: string,
  revision: number,
  ids: string[],
  current: () => boolean,
) {
  const write = writes.then(async () => {
    if (
      !current() ||
      (await calendarCatalogEpoch(voice)) !== epoch ||
      !current() ||
      !voice.accountRevisionMatches(revision)
    )
      return;
    await setGenericPassword(
      calendarApiProvider,
      JSON.stringify({ epoch, ids: calendarCatalogIds(ids) }),
      { service, accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  });
  writes = write.catch(() => undefined);
  return writes;
}
