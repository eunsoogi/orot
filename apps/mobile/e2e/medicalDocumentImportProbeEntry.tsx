import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import { AppRegistry, NativeModules, Text } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import { appearanceStore } from '../src/assistantAppearance/appearanceStore';
import { prepareMedicalDocumentPhotoAppearance } from './medicalDocumentPhotoAppearanceFixture';

/** Keeps the real Records route and repository active for the system-picker import journey. */
function MedicalDocumentImportProbeEntry() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    const manager = NativeModules.SettingsManager as
      | {
          settings?: Record<string, unknown>;
          getConstants?: () => { settings?: Record<string, unknown> };
        }
      | undefined;
    const settings = manager?.settings ?? manager?.getConstants?.().settings;
    // A failed prerequisite must not mount normal routes or pretend onboarding was committed.
    prepareMedicalDocumentPhotoAppearance(settings, appearanceStore).then(
      () => {
        if (active) setState('ready');
      },
      () => {
        if (active) setState('error');
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (state === 'error')
    return <Text>Photo journey appearance setup failed</Text>;
  return state === 'ready' ? <App /> : null;
}

AppRegistry.registerComponent(appName, () => MedicalDocumentImportProbeEntry);
