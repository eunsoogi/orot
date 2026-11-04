import Foundation

/// Uses UTC calendar components, never an ISO timestamp, to preserve the selected civil day.
enum ManualHistorySheetDate {
    enum Decision: Equatable {
        case keep
        case commit(String)
        case invalid
    }

    static var calendar: Calendar {
        var result = Calendar(identifier: .gregorian)
        result.timeZone = TimeZone(secondsFromGMT: 0)!
        return result
    }

    // Era 0, year 1 represents ISO year 0000; older eras are outside the form's four-digit contract.
    static let minimum = componentsDate(year: 0, month: 1, day: 1)!
    static let maximum = componentsDate(year: 9999, month: 12, day: 31)!

    private static func componentsDate(year: Int, month: Int, day: Int) -> Date? {
        calendar.date(from: DateComponents(era: year == 0 ? 0 : 1, year: year == 0 ? 1 : year, month: month, day: day, hour: 12))
    }

    static func initial(_ value: String) -> Date? {
        if value.isEmpty {
            #if OROT_TESTS && targetEnvironment(simulator)
                // A fixed initial month lets the UI test select real SDK calendar days deterministically.
                if let fixture = UserDefaults.standard.string(forKey: "OROT_TEST_MANUAL_HISTORY_DATE"), !fixture.isEmpty {
                    return initial(fixture)
                }
            #endif
            var localGregorian = Calendar(identifier: .gregorian)
            localGregorian.timeZone = .current
            let today = localGregorian.dateComponents([.year, .month, .day], from: Date())
            guard let year = today.year, let month = today.month, let day = today.day else { return nil }
            return componentsDate(year: year, month: month, day: day)
        }
        let pieces = value.split(separator: "-", omittingEmptySubsequences: false)
        guard pieces.count == 3, pieces[0].count == 4, pieces[1].count == 2, pieces[2].count == 2,
              let year = Int(pieces[0]), let month = Int(pieces[1]), let day = Int(pieces[2]),
              valid(year: year, month: month, day: day),
              let date = componentsDate(year: year, month: month, day: day),
              date >= minimum, date <= maximum, string(date) == value
        else { return nil }
        return date
    }

    static func string(_ date: Date) -> String? {
        let parts = calendar.dateComponents([.era, .year, .month, .day], from: date)
        guard let era = parts.era, let componentYear = parts.year,
              let month = parts.month, let day = parts.day else { return nil }
        let year = era == 0 ? 1 - componentYear : componentYear
        guard valid(year: year, month: month, day: day) else { return nil }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// An untouched existing value is authoritative even if the system picker clamps its displayed date.
    static func decision(hasOriginal: Bool, changed: Bool, selected: Date) -> Decision {
        if hasOriginal, !changed {
            return .keep
        }
        guard let value = string(selected) else { return .invalid }
        return .commit(value)
    }

    /// The persisted contract uses proleptic Gregorian dates even when UIKit displays historical Julian days.
    private static func valid(year: Int, month: Int, day: Int) -> Bool {
        guard (0 ... 9999).contains(year), (1 ... 12).contains(month) else { return false }
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
        let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        return (1 ... days[month - 1]).contains(day)
    }
}
