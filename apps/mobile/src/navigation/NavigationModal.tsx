import { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, type ModalProps } from 'react-native';

/** UIKit owns sheet motion, focus and dismissal; no glass-containing ancestor is faded. */
export function NavigationModal(props: Omit<ModalProps, 'animationType'>) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    let changed = false;
    // Accessibility reads must not leave an approval or cancel surface hidden indefinitely.
    const fallback = setTimeout(() => {
      if (mounted && !changed) setReduceMotion(true);
    }, 150);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      enabled => {
        changed = true;
        clearTimeout(fallback);
        if (mounted) setReduceMotion(enabled);
      },
    );
    // Modals can live outside the route provider. Resolve before presentation so
    // the first frame never animates against an already enabled system preference.
    AccessibilityInfo.isReduceMotionEnabled().then(
      enabled => {
        clearTimeout(fallback);
        if (mounted && !changed) setReduceMotion(enabled);
      },
      () => {
        clearTimeout(fallback);
        if (mounted && !changed) setReduceMotion(true);
      },
    );
    return () => {
      mounted = false;
      clearTimeout(fallback);
      subscription.remove();
    };
  }, []);
  return (
    <Modal
      {...props}
      visible={reduceMotion !== null && props.visible !== false}
      animationType={reduceMotion === false ? 'slide' : 'none'}
    />
  );
}
