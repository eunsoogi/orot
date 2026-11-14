import { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, type ModalProps } from 'react-native';

/** UIKit owns sheet motion, focus and dismissal; no glass-containing ancestor is faded. */
export function NavigationModal(props: Omit<ModalProps, 'animationType'>) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      enabled => {
        changed = true;
        if (mounted) setReduceMotion(enabled);
      },
    );
    // Modals can live outside the route provider. Resolve before presentation so
    // the first frame never animates against an already enabled system preference.
    AccessibilityInfo.isReduceMotionEnabled().then(
      enabled => {
        if (mounted && !changed) setReduceMotion(enabled);
      },
      () => {
        if (mounted && !changed) setReduceMotion(true);
      },
    );
    return () => {
      mounted = false;
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
