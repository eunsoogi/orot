import '../src/agent/polyfills';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import { NativeHealthReviewProbe } from '../src/healthReview/NativeHealthReviewProbe';

// This entry belongs only to the integration product; production App still supplies every review route and session.
AppRegistry.registerComponent(appName, () => NativeHealthReviewProbe);
