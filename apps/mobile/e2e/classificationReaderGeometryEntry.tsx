import { AppRegistry, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { name as appName } from '../app.json';
import { ClassificationReaderGeometryProbe } from './ClassificationReaderGeometryProbe';
import {
  NavigationMotionContext,
  useNavigationReduceMotion,
} from '../src/navigation/NavigationMotionContext';

/** The router admits this no-store fixture only under the explicit test bridge opt-in. */
function ClassificationReaderGeometryEntry() {
  const reduceMotion = useNavigationReduceMotion();
  return (
    <NavigationMotionContext.Provider value={reduceMotion}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.fill}>
          <ClassificationReaderGeometryProbe />
        </SafeAreaView>
      </SafeAreaProvider>
    </NavigationMotionContext.Provider>
  );
}
const styles = StyleSheet.create({ fill: { flex: 1 } });
AppRegistry.registerComponent(appName, () => ClassificationReaderGeometryEntry);
