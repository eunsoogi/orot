import { fireEvent, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { NavigationBottomPageActions } from '../../navigation/NavigationBottomPageActions';
import { NavigationGlassSurface } from '../../navigation/NavigationGlassSurface';
import { NavigationPageActionDock } from '../../navigation/NavigationPageActionDock';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { SavedRecordingDeleteAction } from '../SavedRecordingDeleteAction';

export const trashButton = 'saved-recording-detail-delete';
const routeKey = 'synthetic-recording-review';

export function SavedRecordingDeleteDockFixture({
  compact,
  ...props
}: ComponentProps<typeof SavedRecordingDeleteAction> & { compact?: boolean }) {
  const { host, actions } = useNavigationPrimaryActionHost(routeKey);
  const surface = NavigationGlassSurface;
  return (
    <NavigationPrimaryActionContext.Provider value={host}>
      <View testID="recording-detail-body">
        <SavedRecordingDeleteAction {...props} />
      </View>
      {compact ? (
        <NavigationBottomPageActions
          actions={actions}
          disabled={false}
          height={50}
          includeMore={false}
          isDarkAppearance={false}
          onMore={() => {}}
          surface={surface}
        />
      ) : (
        <NavigationPageActionDock
          actions={actions}
          capacity={5}
          disabled={false}
          isDarkAppearance={false}
          isRail
          routeKey={routeKey}
          surface={surface}
          surfaceProps={{ layoutMode: 'right' }}
        />
      )}
    </NavigationPrimaryActionContext.Provider>
  );
}

export function tapRecordingTrash() {
  return fireEvent(
    screen.getByTestId('navigation-page-action-surface'),
    'action',
    { nativeEvent: { id: `page:${trashButton}` } },
  );
}
