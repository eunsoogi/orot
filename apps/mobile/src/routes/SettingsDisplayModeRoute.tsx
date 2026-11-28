import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { t } from '../i18n';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText } from '../layout/AppText';
import { SettingsPageHeading } from '../layout/SettingsPageHeading';
import { appColors } from '../layout/appColors';
import { settingsPageStyles } from '../layout/settingsPagePresentation';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import { NAVIGATION_CONTENT_GAP } from '../navigation/navigationLayout';
import {
  displayModes,
  readAppDisplayMode,
  setAppDisplayMode,
} from './appDisplayMode';
import { DisplayModeThumbnail } from './DisplayModeThumbnail';

/** One mutually exclusive display preference; changes are saved immediately. */
export function SettingsDisplayModeRoute() {
  const [mode, select] = useState(readAppDisplayMode);
  const [laneWidth, setLaneWidth] = useState<number>();
  const { fontScale } = useWindowDimensions();
  // Use the measured content lane, not the total (possibly hinged) window width.
  const stack =
    fontScale >= 1.5 || (laneWidth !== undefined && laneWidth < 244);
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  return (
    <NavigationRouteScrollView testID="settings-display-mode-scroll">
      <AdaptiveColumns
        routeKey="settings-display-mode"
        primary={
          <View style={styles.content}>
            <SettingsPageHeading>
              {t('settings.displayMode')}
            </SettingsPageHeading>
            <View
              accessibilityRole="radiogroup"
              onLayout={event => setLaneWidth(event.nativeEvent.layout.width)}
              style={[styles.group, stack && styles.stack]}
              testID="display-mode-options"
            >
              {displayModes.map(option => {
                const label = t(`settings.displayMode.${option}`);
                const checked = mode === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityLabel={label}
                    accessibilityRole="radio"
                    accessibilityState={{ checked }}
                    onPress={() => {
                      if (readAppDisplayMode() !== option) {
                        setAppDisplayMode(option);
                        select(option);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      stack && styles.stackedOption,
                      pressed && styles.pressed,
                    ]}
                  >
                    <DisplayModeThumbnail mode={option} />
                    <AppText style={styles.label}>{label}</AppText>
                    <View style={[styles.indicator, checked && styles.checked]}>
                      {checked ? (
                        <AppSymbol
                          name="checkmark"
                          size={13}
                          color={appColors.onPrimary}
                        />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
      />
    </NavigationRouteScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    minWidth: 0,
    gap: 20,
    ...settingsPageStyles.inset,
    paddingBottom: 28 - NAVIGATION_CONTENT_GAP,
  },
  group: {
    flexDirection: 'row',
    justifyContent: 'center',
    backgroundColor: appColors.surface,
    gap: 12,
    padding: 14,
    borderRadius: 20,
  },
  stack: { flexDirection: 'column', alignItems: 'stretch' },
  option: { flex: 1, alignItems: 'center', gap: 9, minWidth: 0 },
  stackedOption: { flex: 0, paddingVertical: 8 },
  pressed: { opacity: 0.65 },
  label: { color: appColors.text, fontSize: 15, textAlign: 'center' },
  indicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appColors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: {
    backgroundColor: appColors.primaryAction,
    borderColor: appColors.primaryAction,
  },
});
