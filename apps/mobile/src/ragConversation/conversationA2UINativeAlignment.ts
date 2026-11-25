import type { ViewStyle } from 'react-native';
import type { ConversationA2UIAlignment } from './conversationA2UIAlignment';

const cross: Record<
  NonNullable<ConversationA2UIAlignment['align']>,
  ViewStyle['alignItems']
> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};
const main: Record<
  NonNullable<ConversationA2UIAlignment['justify']>,
  ViewStyle['justifyContent']
> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  spaceBetween: 'space-between',
  spaceAround: 'space-around',
  spaceEvenly: 'space-evenly',
  stretch: 'flex-start',
};

/** Fixed native styles only. A stacked Row deliberately ignores horizontal-axis hints. */
export function a2uiNativeAlignment(
  alignment?: ConversationA2UIAlignment,
): ViewStyle | undefined {
  if (!alignment) return undefined;
  return {
    alignItems: alignment.align ? cross[alignment.align] : undefined,
    justifyContent: alignment.justify ? main[alignment.justify] : undefined,
  };
}

export function a2uiNaturalRowChildren(alignment?: ConversationA2UIAlignment) {
  return alignment?.justify !== undefined && alignment.justify !== 'stretch';
}

export const a2uiStretchedColumnChild: ViewStyle = {
  flexGrow: 1,
  minWidth: 0,
  maxWidth: '100%',
};
