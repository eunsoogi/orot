# Daily report reminder policy

Daily reminders are off until the person explicitly enables them and selects a local hour and minute. Saving an enabled preference may request notification permission; foreground reconciliation never prompts. The preference remains saved if permission is denied, so the person can change authorization in system settings. A later foreground reconciles it again.

The recurring calendar trigger follows the device's current local time zone, including after travel. The report opened later must independently identify today's calendar date and explicit IANA time zone using the daily report context contract. The operating system resolves daylight-saving gaps and repeated times and does not guarantee exact delivery. The notification contains only a generic invitation and the `daily_report` entry type; it contains no health information and does not generate a report. Delivery routing is a separate integration.
