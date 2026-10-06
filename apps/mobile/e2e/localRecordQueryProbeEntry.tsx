// Encrypted storage derives its local key from the app's installed random-source polyfill.
import '../src/agent/polyfills';
import { AppRegistry } from 'react-native';
import { LocalRecordQueryProbe } from './localRecordQueryProbe';

// AppDelegate starts OrotMobile, so the alternate Release entry must register the same key.
AppRegistry.registerComponent('OrotMobile', () => LocalRecordQueryProbe);
