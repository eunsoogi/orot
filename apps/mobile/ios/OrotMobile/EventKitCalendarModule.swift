import EventKit
import Foundation
import React

@objc(EventKitCalendarModule)
public final class EventKitCalendarModule: RCTEventEmitter {
  private let eventStore = EKEventStore()
  private let eventQueue = DispatchQueue(label: "com.orot.calendar.event-store")
  private var eventStoreObserver: NSObjectProtocol?
  private var hasListeners = false

  @objc override public static func requiresMainQueueSetup() -> Bool { false }
  override public func supportedEvents() -> [String]! { ["eventStoreChanged"] }

  override public func startObserving() {
    hasListeners = true
    eventStoreObserver = NotificationCenter.default.addObserver(
      forName: .EKEventStoreChanged,
      object: eventStore,
      queue: nil
    ) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self, self.hasListeners else { return }
        self.sendEvent(withName: "eventStoreChanged", body: nil)
      }
    }
  }

  override public func stopObserving() {
    hasListeners = false
    if let eventStoreObserver {
      NotificationCenter.default.removeObserver(eventStoreObserver)
      self.eventStoreObserver = nil
    }
  }

  @objc(requestAccessAndListUpcomingEvents:rejecter:)
  public func requestAccessAndListUpcomingEvents(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    eventQueue.async {
      self.requestAccessIfNeeded { access in
        let events = access == "fullAccess" ? self.upcomingEvents() : []
        resolve(["access": access, "events": events] as NSDictionary)
      }
    }
  }

  @objc(findEvent:occurrenceDate:resolver:rejecter:)
  public func findEvent(
    _ calendarEventIdentifier: String,
    occurrenceDate: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    eventQueue.async {
      let access = self.currentAccess()
      guard access == "fullAccess" else {
        resolve(["access": access, "event": NSNull()] as NSDictionary)
        return
      }
      let event = self.findEvent(
        identifier: calendarEventIdentifier,
        occurrenceDate: occurrenceDate.flatMap(Self.parseTimestamp)
      )
      let serializedEvent: Any
      if let event, let value = self.serialize(event) {
        serializedEvent = value
      } else {
        serializedEvent = NSNull()
      }
      resolve([
        "access": access,
        "event": serializedEvent,
      ] as NSDictionary)
    }
  }

  private func requestAccessIfNeeded(completion: @escaping (String) -> Void) {
    guard currentAccess() == "notDetermined" else {
      completion(currentAccess())
      return
    }

    let accessCompletion: (Bool, Error?) -> Void = { [weak self] _, _ in
      guard let self else { return }
      self.eventQueue.async { completion(self.currentAccess()) }
    }
    if #available(iOS 17.0, *) {
      eventStore.requestFullAccessToEvents(completion: accessCompletion)
    } else {
      eventStore.requestAccess(to: .event, completion: accessCompletion)
    }
  }

  private func currentAccess() -> String {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(iOS 17.0, *) {
      switch status {
      case .fullAccess: return "fullAccess"
      case .writeOnly: return "writeOnly"
      case .authorized: return "fullAccess"
      case .notDetermined: return "notDetermined"
      case .denied: return "denied"
      case .restricted: return "restricted"
      @unknown default: return "denied"
      }
    }

    if status == .authorized { return "fullAccess" }
    if status == .notDetermined { return "notDetermined" }
    if status == .denied { return "denied" }
    if status == .restricted { return "restricted" }
    return "denied"
  }

  private func upcomingEvents() -> [[String: Any]] {
    let start = Date()
    let end = Calendar.current.date(byAdding: .year, value: 1, to: start) ?? start
    let predicate = eventStore.predicateForEvents(
      withStart: start,
      end: end,
      calendars: nil
    )
    return eventStore.events(matching: predicate)
      .filter { $0.startDate >= start && $0.startDate < end }
      .sorted {
        if $0.startDate == $1.startDate {
          return ($0.eventIdentifier ?? "") < ($1.eventIdentifier ?? "")
        }
        return $0.startDate < $1.startDate
      }
      .prefix(100)
      .compactMap(serialize)
  }

  private func findEvent(identifier: String, occurrenceDate: Date?) -> EKEvent? {
    guard let occurrenceDate else {
      return eventStore.event(withIdentifier: identifier)
    }

    // event(withIdentifier:) returns the first occurrence for a recurring item.
    // Search only around the stored occurrence and require both identity and date.
    let start = occurrenceDate.addingTimeInterval(-86_400)
    let end = occurrenceDate.addingTimeInterval(86_400)
    let predicate = eventStore.predicateForEvents(
      withStart: start,
      end: end,
      calendars: nil
    )
    return eventStore.events(matching: predicate).first { event in
      guard event.eventIdentifier == identifier, let candidateDate = event.occurrenceDate else {
        return false
      }
      return abs(candidateDate.timeIntervalSince(occurrenceDate)) < 1
    }
  }

  private func serialize(_ event: EKEvent) -> [String: Any]? {
    guard let identifier = event.eventIdentifier, !identifier.isEmpty else { return nil }
    let occurrenceDate: Any
    if let date = event.occurrenceDate {
      occurrenceDate = Self.timestamp(date)
    } else {
      occurrenceDate = NSNull()
    }
    let timeZoneIdentifier: Any
    if let identifier = event.timeZone?.identifier {
      timeZoneIdentifier = identifier
    } else {
      timeZoneIdentifier = NSNull()
    }
    return [
      "calendarEventIdentifier": identifier,
      "effectiveAt": Self.timestamp(event.startDate),
      "endsAt": Self.timestamp(event.endDate),
      "calendarEventSnapshot": [
        "title": event.title ?? "",
        "timeZoneIdentifier": timeZoneIdentifier,
        "isAllDay": event.isAllDay,
        "occurrenceDate": occurrenceDate,
        "isDetached": event.isDetached,
        "recurrenceRules": (event.recurrenceRules ?? []).map(serialize),
      ],
    ]
  }

  private func serialize(_ rule: EKRecurrenceRule) -> [String: Any] {
    let end: Any
    if let date = rule.recurrenceEnd?.endDate {
      end = ["kind": "date", "date": Self.timestamp(date)]
    } else if let count = rule.recurrenceEnd?.occurrenceCount, count > 0 {
      end = ["kind": "count", "occurrenceCount": count]
    } else {
      end = NSNull()
    }

    let daysOfTheWeek: Any
    if let days = rule.daysOfTheWeek {
      daysOfTheWeek = days.map {
        ["dayOfTheWeek": $0.dayOfTheWeek.rawValue, "weekNumber": $0.weekNumber]
      }
    } else {
      daysOfTheWeek = NSNull()
    }

    return [
      "frequency": frequencyName(rule.frequency),
      "interval": rule.interval,
      "firstDayOfTheWeek": rule.firstDayOfTheWeek,
      "daysOfTheWeek": daysOfTheWeek,
      "daysOfTheMonth": numbers(rule.daysOfTheMonth),
      "monthsOfTheYear": numbers(rule.monthsOfTheYear),
      "weeksOfTheYear": numbers(rule.weeksOfTheYear),
      "daysOfTheYear": numbers(rule.daysOfTheYear),
      "setPositions": numbers(rule.setPositions),
      "end": end,
    ]
  }

  private func frequencyName(_ frequency: EKRecurrenceFrequency) -> String {
    switch frequency {
    case .daily: return "daily"
    case .weekly: return "weekly"
    case .monthly: return "monthly"
    case .yearly: return "yearly"
    @unknown default: return "daily"
    }
  }

  private func numbers(_ values: [NSNumber]?) -> Any {
    guard let values else { return NSNull() }
    return values.map(\.intValue)
  }

  private static func timestamp(_ date: Date) -> String {
    fractionalTimestampFormatter.string(from: date)
  }

  private static func parseTimestamp(_ value: String) -> Date? {
    fractionalTimestampFormatter.date(from: value) ?? timestampFormatter.date(from: value)
  }

  private static let fractionalTimestampFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  private static let timestampFormatter = ISO8601DateFormatter()
}
