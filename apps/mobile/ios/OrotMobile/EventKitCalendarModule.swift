import EventKit
import Foundation
import React

@objc(EventKitCalendarModule)
public final class EventKitCalendarModule: RCTEventEmitter {
    private let eventStore = EKEventStore()
    private let eventQueue = DispatchQueue(label: "com.orot.calendar.event-store")
    private var eventStoreObserver: NSObjectProtocol?
    private var hasListeners = false

    @objc override public static func requiresMainQueueSetup() -> Bool {
        false
    }

    override public func supportedEvents() -> [String]! {
        ["eventStoreChanged"]
    }

    override public func startObserving() {
        hasListeners = true
        eventStoreObserver = NotificationCenter.default.addObserver(
            forName: .EKEventStoreChanged,
            object: eventStore,
            queue: nil,
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

    @objc(requestEventAccess:rejecter:)
    public func requestEventAccess(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        eventQueue.async {
            // Return consent state alone so the coordinator can finish other selected prompts before queries.
            self.requestAccessIfNeeded { access in resolve(access) }
        }
    }

    @objc(listUpcomingEvents:rejecter:)
    public func listUpcomingEvents(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        eventQueue.async {
            let access = EventKitCalendarSnapshot.currentAccess()
            resolve(self.upcomingEvents(access: access) as NSDictionary)
        }
    }

    /// Read only: requesting OS permission remains an explicit, separate user action.
    @objc(listEventsInRange:toExclusive:resolver:rejecter:)
    public func listEventsInRange(
        _ fromInclusive: String,
        toExclusive: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        eventQueue.async {
            guard let start = Self.parseTimestamp(fromInclusive),
                  let end = Self.parseTimestamp(toExclusive), end > start,
                  end.timeIntervalSince(start) <= 32 * 86400
            else {
                reject("invalid_calendar_window", "Invalid calendar query window.", nil)
                return
            }
            let access = EventKitCalendarSnapshot.currentAccess()
            let result = EventKitCalendarSnapshot.eventsInRange(
                store: self.eventStore, start: start, end: end, access: access,
            )
            // Permission loss during a read must not return previously accessible titles.
            resolve(EventKitCalendarSnapshot.currentAccess() == access ? result : [
                "access": EventKitCalendarSnapshot.currentAccess(), "events": [],
            ])
        }
    }

    @objc(requestAccessAndListUpcomingEvents:rejecter:)
    public func requestAccessAndListUpcomingEvents(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        eventQueue.async {
            self.requestAccessIfNeeded { access in
                resolve(self.upcomingEvents(access: access) as NSDictionary)
            }
        }
    }

    @objc(findEvent:occurrenceDate:floatingOccurrenceAt:resolver:rejecter:)
    public func findEvent(
        _ calendarEventIdentifier: String,
        occurrenceDate: String?,
        floatingOccurrenceAt: String?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        eventQueue.async {
            let access = EventKitCalendarSnapshot.currentAccess()
            guard access == "fullAccess" else {
                resolve(["access": access, "event": NSNull()] as NSDictionary)
                return
            }
            if let floatingOccurrenceAt,
               EventKitCalendarSnapshot.date(fromFloatingDateTime: floatingOccurrenceAt) == nil
            {
                resolve(["access": access, "event": NSNull()] as NSDictionary)
                return
            }
            let event = self.findEvent(
                identifier: calendarEventIdentifier,
                occurrenceDate: occurrenceDate.flatMap(Self.parseTimestamp),
                floatingOccurrenceAt: floatingOccurrenceAt,
            )
            let serializedEvent: Any = if let event, let value = EventKitCalendarSnapshot.serialize(event) {
                value
            } else {
                NSNull()
            }
            resolve([
                "access": access,
                "event": serializedEvent,
            ] as NSDictionary)
        }
    }

    private func requestAccessIfNeeded(completion: @escaping (String) -> Void) {
        guard EventKitCalendarSnapshot.currentAccess() == "notDetermined" else {
            completion(EventKitCalendarSnapshot.currentAccess())
            return
        }

        let accessCompletion: (Bool, Error?) -> Void = { [weak self] _, _ in
            guard let self else { return }
            eventQueue.async { completion(EventKitCalendarSnapshot.currentAccess()) }
        }
        if #available(iOS 17.0, *) {
            eventStore.requestFullAccessToEvents(completion: accessCompletion)
        } else {
            eventStore.requestAccess(to: .event, completion: accessCompletion)
        }
    }

    private func upcomingEvents(access: String) -> [String: Any] {
        let start = Date()
        let end = Calendar.current.date(byAdding: .year, value: 1, to: start) ?? start
        let predicate = eventStore.predicateForEvents(
            withStart: start,
            end: end,
            calendars: nil,
        )
        // All readable occurrences in this one-year window are returned, without a row cap.
        let matching = (access == "fullAccess" ? eventStore.events(matching: predicate) : [])
            .filter { $0.startDate >= start && $0.startDate < end }
            .sorted {
                if $0.startDate == $1.startDate {
                    return ($0.eventIdentifier ?? "") < ($1.eventIdentifier ?? "")
                }
                return $0.startDate < $1.startDate
            }
        let events = matching.compactMap(EventKitCalendarSnapshot.serialize)
        // A missing stable identifier cannot be revalidated; disclose any omitted occurrence.
        return [
            "access": access,
            "events": events,
            "query": [
                "fromInclusive": Self.fractionalTimestampFormatter.string(from: start),
                "toExclusive": Self.fractionalTimestampFormatter.string(from: end),
                "horizonYears": 1,
                "resultLimit": NSNull(),
                "complete": access == "fullAccess" && events.count == matching.count,
                "omittedEventCount": matching.count - events.count,
            ],
        ]
    }

    private func findEvent(
        identifier: String,
        occurrenceDate: Date?,
        floatingOccurrenceAt: String?,
    ) -> EKEvent? {
        let targetDate = floatingOccurrenceAt.flatMap(
            EventKitCalendarSnapshot.date(fromFloatingDateTime:),
        ) ?? occurrenceDate
        guard let targetDate else {
            return eventStore.event(withIdentifier: identifier)
        }

        // event(withIdentifier:) returns the first occurrence for a recurring item.
        // Search only around the stored occurrence and require both identity and date.
        let start = targetDate.addingTimeInterval(-86400)
        let end = targetDate.addingTimeInterval(86400)
        let predicate = eventStore.predicateForEvents(
            withStart: start,
            end: end,
            calendars: nil,
        )
        return eventStore.events(matching: predicate).first { event in
            guard event.eventIdentifier == identifier, let candidateDate = event.occurrenceDate else {
                return false
            }
            if let floatingOccurrenceAt {
                return EventKitCalendarSnapshot.floatingDateTime(candidateDate) ==
                    floatingOccurrenceAt
            }
            return abs(candidateDate.timeIntervalSince(targetDate)) < 1
        }
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
