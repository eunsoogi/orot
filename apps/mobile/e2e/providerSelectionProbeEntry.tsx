import '../src/agent/polyfills';
import { AppRegistry } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { name as appName } from '../app.json';
import { ProviderSelectionProbe } from './providerSelectionProbe';

/** Synthetic lifecycle controls must remain below the real status bar, just as the other native capability fixtures do. */
function ProviderSelectionTestRoot() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }}>
        <ProviderSelectionProbe />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent(appName, () => ProviderSelectionTestRoot);
