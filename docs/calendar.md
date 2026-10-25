# Calendar linking

> Current XCTest/XCUITest commands are in [development.md](development.md); the [requirement map](ios-validation.md) links the original scenarios to their maintained tests.

Calendar linking lets a user choose an upcoming event and confirm it as the
next outpatient visit. Orot does not decide which events are medical visits.
The candidate list is shown locally, sorted by start time, and currently covers
the next year (up to 100 events). An event is persisted only after the user
selects it and confirms the displayed details.

## Access and local data

Orot requests Calendar access only after the user taps the Calendar action. On
iOS 17 and later it requests EventKit full access; EventKit does not offer a
read-only authorization level for this flow. On earlier supported iOS versions
it uses the legacy event-access request. Full access lets an app read and write
Calendar data, but this feature only lists and looks up events. It does not add,
edit, or delete Calendar events. The two usage-description strings in
`Info.plist` explain this permission to the user. See Apple's
[EventKit access guide](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)
and [`requestFullAccessToEvents`](https://developer.apple.com/documentation/eventkit/ekeventstore/requestfullaccesstoevents%28completion%3A%29).

Before confirmation, candidate events remain in app memory. Confirmation stores
the selected event identifier and appointment snapshot in Orot's encrypted
local SQLCipher database. Orot does not persist or upload the candidate list or
other Calendar events. The snapshot includes the selected event's title,
start/end, time-zone identifier, all-day flag, occurrence date, detached
occurrence flag, and recurrence rule. EventKit's event identifier may change
when an event moves to another calendar, so Orot also checks the selected
occurrence when it verifies a saved appointment. See Apple's
[`eventIdentifier`](https://developer.apple.com/documentation/EventKit/EKEvent/eventIdentifier)
and [`recurrenceRules`](https://developer.apple.com/documentation/EventKit/EKCalendarItem/recurrenceRules).

For floating events, EventKit reports a `nil` time zone and returns `startDate`
in the system's default time zone. Orot also stores the event's local civil
start/end and occurrence components so a device time-zone change does not move
the visit on screen or make the same occurrence look changed. See Apple's
[`timeZone`](https://developer.apple.com/documentation/eventkit/ekcalendaritem/timezone)
and [`startDate`](https://developer.apple.com/documentation/eventkit/ekevent/startdate) documentation.

## Changes and removal

Orot checks a linked event when EventKit reports a change and when the app
returns to the foreground. If lookup finds an event whose saved details have
changed, Orot shows the new details for the user to review and confirm. If the
event is missing or no longer resolves, Orot asks the user to choose another
event. Orot does not silently change or cancel the saved appointment.

Calendar selection, permission, empty-state, confirmation, and next-visit text
use the app's Korean strings.

## Synthetic iOS Simulator check

`CalendarSelectionUITests/testOnlyTheSelectedSyntheticEventIsConfirmedFromTheScheduleTab` runs in the `fixtures` profile's `calendar` group. The test-only `SyntheticCalendarTestModule` supplies an unrelated meeting and a clinic-visit fixture without calling EventKit. The test checks selection, explicit confirmation and the displayed Asia/Seoul time through the real Schedule route.

This proves the app's behavior with synthetic events; it does not prove an iOS permission prompt or access to a real calendar. Use the development guide's fixture preparation and exact test-selection commands. Production builds exclude the synthetic bridge.
