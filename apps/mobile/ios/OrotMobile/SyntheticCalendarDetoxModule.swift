#if OROT_CALENDAR_DETOX && targetEnvironment(simulator)
import Foundation
import React

/// Synthetic-only EventKit substitute for the independent Calendar Detox entry.
/// It has no EventKit dependency and cannot inspect or modify system calendars.
@objc(SyntheticCalendarDetoxModule)
public final class SyntheticCalendarDetoxModule: RCTEventEmitter {
  @objc override public static func requiresMainQueueSetup() -> Bool { false }
  override public func supportedEvents() -> [String]! { ["eventStoreChanged"] }

  @objc(requestAccessAndListUpcomingEvents:rejecter:)
  public func requestAccessAndListUpcomingEvents(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(["access": "fullAccess", "events": Self.events] as NSDictionary)
  }

  @objc(findEvent:occurrenceDate:floatingOccurrenceAt:resolver:rejecter:)
  public func findEvent(
    _ calendarEventIdentifier: String,
    occurrenceDate: String?,
    floatingOccurrenceAt: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let event = Self.events.first {
      $0["calendarEventIdentifier"] as? String == calendarEventIdentifier
    }
    resolve(["access": "fullAccess", "event": event ?? NSNull()] as NSDictionary)
  }

  private static let events: [[String: Any]] = [
    event(
      identifier: "calendar-synthetic-unrelated",
      title: "팀 회의 테스트 데이터",
      effectiveAt: "2035-06-01T00:00:00.000Z",
      endsAt: "2035-06-01T01:00:00.000Z"
    ),
    event(
      identifier: "calendar-synthetic-clinic",
      title: "합성 외래 방문",
      effectiveAt: "2035-06-02T00:00:00.000Z",
      endsAt: "2035-06-02T01:00:00.000Z"
    ),
  ]

  private static func event(
    identifier: String,
    title: String,
    effectiveAt: String,
    endsAt: String
  ) -> [String: Any] {
    return [
      "calendarEventIdentifier": identifier,
      "effectiveAt": effectiveAt,
      "endsAt": endsAt,
      "calendarEventSnapshot": [
        "title": title,
        "timeZoneIdentifier": "Asia/Seoul",
        "isAllDay": false,
        "floatingStartAt": NSNull(),
        "floatingEndAt": NSNull(),
        "occurrenceDate": NSNull(),
        "floatingOccurrenceAt": NSNull(),
        "isDetached": false,
        "recurrenceRules": [[String: Any]](),
      ],
    ]
  }
}
#endif
