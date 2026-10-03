# Mobile localization

The app ships one language resource, `ko.ts`. `resolveLanguage()` maps the device locale to the available catalog and falls back to Korean for every unsupported locale. The app has no language selector.

Use `t('key')` for app-owned text. Message placeholders are inferred from the Korean resource and require matching string or number values, for example `t('appointments.actions.cancelForClinic', { clinic })`.

Use `formatDate`, `formatTime`, `formatDateTime`, and `formatNumber` for display. Date formatters accept `Date` values representing instants; pass a time zone when a screen needs one other than the device's. Keep stored timestamps, enum values, IDs, input formats, and user-entered text unchanged.

When adding another language in a later release, add a resource with the same keys, register it in `supportedLanguages` and `resources`, and update locale resolution. Add localized component and Simulator coverage for its fallback and formatting behavior.
