/** Count both Intl entry points so changing the formatter cannot hide probes
 * from the calendar reuse budgets. The supplied formatter belongs to the test.
 */
export function observeCalendarProbes(formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts;
  const format = formatter.format;
  let probes = 0;
  formatter.formatToParts = instant => {
    probes++;
    return parts.call(formatter, instant);
  };
  // Intl exposes format through a getter. Shadow it only on this test instance.
  Object.defineProperty(formatter, 'format', {
    value(instant: number | Date) {
      probes++;
      return format(instant);
    },
    configurable: true,
  });
  return {
    get count() {
      return probes;
    },
    reset() {
      probes = 0;
    },
    dispose() {
      formatter.formatToParts = parts;
      Reflect.deleteProperty(formatter, 'format');
    },
  };
}
