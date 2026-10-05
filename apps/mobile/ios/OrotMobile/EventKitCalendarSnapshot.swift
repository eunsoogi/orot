import EventKit
import Foundation

enum EventKitCalendarSnapshot {
    static func serialize(_ event: EKEvent) -> [String: Any]? {
        guard let identifier = event.eventIdentifier, !identifier.isEmpty else { return nil }
        let isFloating = event.timeZone == nil
        let occurrenceDate: Any
        let floatingOccurrenceAt: Any
        if let date = event.occurrenceDate, isFloating {
            occurrenceDate = NSNull()
            floatingOccurrenceAt = floatingDateTime(date)
        } else if let date = event.occurrenceDate {
            occurrenceDate = timestamp(date)
            floatingOccurrenceAt = NSNull()
        } else {
            occurrenceDate = NSNull()
            floatingOccurrenceAt = NSNull()
        }

        let zoneValue: Any = if let timeZone = event.timeZone {
            timeZone.identifier
        } else {
            NSNull()
        }
        let floatingStartAt: Any = isFloating
            ? floatingDateTime(event.startDate)
            : NSNull()
        let floatingEndAt: Any = isFloating
            ? floatingDateTime(event.endDate)
            : NSNull()

        return [
            "calendarEventIdentifier": identifier,
            "effectiveAt": timestamp(event.startDate),
            "endsAt": timestamp(event.endDate),
            "calendarEventSnapshot": [
                "title": event.title ?? "",
                "timeZoneIdentifier": zoneValue,
                "isAllDay": event.isAllDay,
                "floatingStartAt": floatingStartAt,
                "floatingEndAt": floatingEndAt,
                "occurrenceDate": occurrenceDate,
                "floatingOccurrenceAt": floatingOccurrenceAt,
                "isDetached": event.isDetached,
                "recurrenceRules": (event.recurrenceRules ?? []).map {
                    serialize($0, isFloating: isFloating)
                },
            ],
        ]
    }

    static func floatingDateTime(_ date: Date) -> String {
        dateFormatter().string(from: date)
    }

    static func date(fromFloatingDateTime value: String) -> Date? {
        guard let date = dateFormatter().date(from: value),
              floatingDateTime(date) == value
        else {
            return nil
        }
        return date
    }

    private static func serialize(
        _ rule: EKRecurrenceRule,
        isFloating: Bool,
    ) -> [String: Any] {
        let end: Any
        if let date = rule.recurrenceEnd?.endDate {
            let recurrenceDate: Any
            let floatingDateTime: Any
            if isFloating {
                recurrenceDate = NSNull()
                floatingDateTime = Self.floatingDateTime(date)
            } else {
                recurrenceDate = Self.timestamp(date)
                floatingDateTime = NSNull()
            }
            end = [
                "kind": "date",
                "date": recurrenceDate,
                "floatingDateTime": floatingDateTime,
            ]
        } else if let count = rule.recurrenceEnd?.occurrenceCount, count > 0 {
            end = ["kind": "count", "occurrenceCount": count]
        } else {
            end = NSNull()
        }

        let daysOfTheWeek: Any = if let days = rule.daysOfTheWeek {
            days.map {
                ["dayOfTheWeek": $0.dayOfTheWeek.rawValue, "weekNumber": $0.weekNumber]
            }
        } else {
            NSNull()
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

    private static func frequencyName(_ frequency: EKRecurrenceFrequency) -> String {
        switch frequency {
        case .daily: return "daily"
        case .weekly: return "weekly"
        case .monthly: return "monthly"
        case .yearly: return "yearly"
        @unknown default: return "daily"
        }
    }

    private static func numbers(_ values: [NSNumber]?) -> Any {
        guard let values else { return NSNull() }
        return values.map(\.intValue)
    }

    private static func timestamp(_ date: Date) -> String {
        fractionalTimestampFormatter.string(from: date)
    }

    private static func dateFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS"
        formatter.isLenient = false
        return formatter
    }

    private static let fractionalTimestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
