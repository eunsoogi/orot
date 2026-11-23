import { createContext, type RefObject } from 'react';
import type { HostInstance } from 'react-native';

/** Only provide an untransformed ancestor with the same horizontal lane as the columns. */
export const AdaptiveColumnsMeasurementRoot =
  createContext<RefObject<HostInstance | null> | null>(null);
