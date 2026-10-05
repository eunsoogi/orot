import '../src/agent/polyfills';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import { TranscriptionProbe } from './transcription/transcriptionProbe';

// An alternate entry lets Simulator tests call the provider without adding probe controls to the product app.
AppRegistry.registerComponent(appName, () => TranscriptionProbe);
