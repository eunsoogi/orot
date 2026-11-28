import { calendarDecisionsModel } from '@orot/provider-openai';
import type { ModelSettingsServices } from '../agent/execution/ModelSettingsServices';
import {
  calendarApiProvider,
  readCalendarCatalog,
} from './calendarCatalogCache';

/** A previously approved saved choice can show its check on upgrade before
 * the first catalog is cached. It still never enters the fresh options. */
export async function readCalendarCatalogDisplay(
  services: ModelSettingsServices,
  revision: number,
  signal: AbortSignal,
  current: () => boolean,
) {
  const { calendar, voice, reuseApproval } = services;
  const owned = () =>
    !signal.aborted && current() && voice.accountRevisionMatches(revision);
  const ids = await readCalendarCatalog(voice, revision);
  if (!owned()) return [];
  if (ids.length) return ids.map(id => services.calendarOption(id, revision));
  if (!reuseApproval) return [];
  try {
    const saved = await calendar.load();
    if (
      !owned() ||
      saved?.providerId !== calendarApiProvider ||
      saved.modelId !== calendarDecisionsModel
    )
      return [];
    const option = services.calendarOption(saved.modelId, revision);
    if (
      !(await reuseApproval(
        { slot: 'calendar', option, signal, isCurrent: owned },
        calendar,
      )) ||
      !owned()
    )
      return [];
    return [option];
  } catch {
    return [];
  }
}
