import 'react-native-get-random-values';
import { AppRegistry, NativeModules, Text, View } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import { createCalendarBridge } from '../src/calendar/calendarBridge';

function syntheticProbeRequested(): boolean {
  const settingsManager = (NativeModules as unknown as {
    SettingsManager?: {
      settings?: Record<string, unknown>;
      getConstants?: () => { settings?: Record<string, unknown> };
    };
  }).SettingsManager;
  const value =
    settingsManager?.settings?.OROT_CALENDAR_PROBE ??
    settingsManager?.getConstants?.().settings?.OROT_CALENDAR_PROBE;
  return value === 'synthetic';
}

function CalendarProbeEntry() {
  const nativeProbe = (
    NativeModules as unknown as { SyntheticCalendarDetoxModule?: unknown }
  ).SyntheticCalendarDetoxModule;
  if (!syntheticProbeRequested() || !nativeProbe) {
    return (
      <View>
        <Text testID="calendar-probe-disabled">
          Calendar synthetic probe is disabled.
        </Text>
      </View>
    );
  }

  return (
    <App
      calendarBridge={createCalendarBridge(
        nativeProbe as Parameters<typeof createCalendarBridge>[0],
      )}
    />
  );
}

AppRegistry.registerComponent(appName, () => CalendarProbeEntry);
