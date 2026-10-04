import { NativeModules, Platform } from 'react-native';
import { createHealthKitClient } from './client';
import type { HealthKitNativeModule } from './types';

const nativeModule = NativeModules.HealthKitModule as HealthKitNativeModule | undefined;

export const healthKit = createHealthKitClient(
  nativeModule,
  Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other',
);
