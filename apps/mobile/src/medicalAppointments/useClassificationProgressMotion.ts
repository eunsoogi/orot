import { useContext, useEffect, useRef, useState } from 'react';
import { NavigationMotionContext } from '../navigation/NavigationMotionContext';

const durationMs = 260;

/** Real validated counts own the target; motion only eases toward that count.
 * A backwards target is a reset, not an animated decrease or predicted work. */
export function useClassificationProgressMotion(target: number) {
  const reduced = useContext(NavigationMotionContext);
  const value = useRef(target);
  const previousTarget = useRef(target);
  const [visible, setVisible] = useState(target);
  useEffect(() => {
    const from = value.current;
    const reset = target < previousTarget.current;
    previousTarget.current = target;
    if (reduced || reset || target <= from) {
      value.current = target;
      setVisible(target);
      return;
    }
    let frame: number;
    let started: number | undefined;
    let current = true;
    const tick = (time: number) => {
      if (!current) return;
      started ??= time;
      const ratio = Math.min(1, Math.max(0, (time - started) / durationMs));
      const eased = 1 - Math.pow(1 - ratio, 3);
      // Neither rounding nor a stale frame can visibly claim unconfirmed work.
      value.current = Math.max(
        value.current,
        ratio === 1
          ? target
          : Math.min(target, Math.floor(from + (target - from) * eased)),
      );
      setVisible(value.current);
      if (ratio < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      current = false;
      cancelAnimationFrame(frame);
    };
  }, [target, reduced]);
  return reduced || target < previousTarget.current
    ? target
    : Math.min(target, visible);
}
