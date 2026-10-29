import { createContext } from 'react';
import type { NavigationGeometryRect } from './navigationGeometry';

/** A committed overlay layout invalidates measurement; these local coordinates never replace UIKit's window frame. */
export const NavigationOverlayLayoutContext =
  createContext<NavigationGeometryRect | null>(null);
