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

    @objc(requestAccessAndListUpcomingEvents:rejecter:)
    public func requestAccessAndListUpcomingEvents(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        eventQueue.async {
            self.requestAccessIfNeeded { access in
                let events = access == "fullAccess" ? self.upcomingEvents() : []
                resolve(["access": access, "events": events] as NSDictionary)
            }
        }
    }

    @objc(requestAccessIfNeeded:rejecter:)
    public func requestCalendarAccess(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        // The unified coordinator waits for this consent result before it starts any selected query.
        eventQueue.async {
            self.requestAccessIfNeeded { access in resolve(access) }
        }
    }

    @objc(listUpcomingEvents:rejecter:)
    public func listUpcomingCalendarEvents(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        eventQueue.async {
            // Querying is deliberately prompt-free so one selected import never asks once per event.
            let access = self.currentAccess()
            let events = access == "fullAccess" ? self.upcomingEvents() : []
            resolve(["access": access, "events": events] as NSDictionary)
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
            let access = self.currentAccess()
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
        guard currentAccess() == "notDetermined" else {
            completion(currentAccess())
            return
        }

        let accessCompletion: (Bool, Error?) -> Void = { [weak self] _, _ in
            guard let self else { return }
            eventQueue.async { completion(self.currentAccess()) }
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

        if status == .authorized {
            return "fullAccess"
        }
        if status == .notDetermined {
            return "notDetermined"
        }
        if status == .denied {
            return "denied"
        }
        if status == .restricted {
            return "restricted"
        }
        return "denied"
    }

    private func upcomingEvents() -> [[String: Any]] {
        let start = Date()
        let end = Calendar.current.date(byAdding: .year, value: 1, to: start) ?? start
        let predicate = eventStore.predicateForEvents(
            withStart: start,
            end: end,
            calendars: nil,
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
            .compactMap(EventKitCalendarSnapshot.serialize)
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
