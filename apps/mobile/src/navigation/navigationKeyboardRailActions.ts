import { navigationMoreDescriptor } from './navigationActionDescriptor';
import type { NavigationGlassAction } from './NavigationGlassSurface';

/** A compact side menu retains navigation access without moving tabs above the keyboard. */
export function navigationKeyboardRailActions(
  actions: readonly NavigationGlassAction[],
  height: number,
  top: number,
  bottom: number,
) {
  const available = Math.max(0, height - top - bottom);
  const back = actions.find(action => action.id === 'back');
  const direct = back && available >= 120 ? [back] : [];
  const more = {
    ...navigationMoreDescriptor(false),
    id: 'navigation-overflow',
  };
  return {
    actions: available >= 60 ? [...direct, more] : [],
    overflow: actions
      .filter(action => !direct.includes(action))
      .map(action => action.id),
  };
}
