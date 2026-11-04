import Foundation

/// Exercises civil-date conversion independently of UIKit and the device's current time zone.
@main
struct DateSheetDateRegression {
    static func main() {
        for zone in ["Pacific/Kiritimati", "America/Los_Angeles", "Asia/Seoul"] {
            NSTimeZone.default = TimeZone(identifier: zone)!
            for value in ["0000-01-01", "0000-02-29", "0001-01-01", "0004-02-29", "0100-02-28", "1583-01-01", "1900-02-28", "2000-02-29", "2024-02-29", "2024-03-01", "9999-12-31"] {
                guard let date = ManualHistorySheetDate.initial(value) else { fatalError("Missing \(value) in \(zone)") }
                precondition(ManualHistorySheetDate.string(date) == value, "Changed \(value) in \(zone)")
            }
            for value in ["0100-02-29", "1500-02-29", "1900-02-29", "2023-02-29", "2024-04-31"] {
                precondition(ManualHistorySheetDate.initial(value) == nil, "Accepted \(value) in \(zone)")
            }
            let fallback = ManualHistorySheetDate.initial("2024-02-29")!
            precondition(ManualHistorySheetDate.decision(hasOriginal: true, changed: false, selected: fallback) == .keep)
            precondition(ManualHistorySheetDate.decision(hasOriginal: true, changed: true, selected: fallback) == .commit("2024-02-29"))
            let julianLeap = ManualHistorySheetDate.calendar.date(from: DateComponents(year: 1500, month: 2, day: 29, hour: 12))!
            if ManualHistorySheetDate.calendar.component(.day, from: julianLeap) == 29 {
                precondition(ManualHistorySheetDate.decision(hasOriginal: false, changed: true, selected: julianLeap) == .invalid)
            }
            if let cutover = ManualHistorySheetDate.initial("1582-10-10") {
                precondition(ManualHistorySheetDate.string(cutover) == "1582-10-10")
            }
        }
        print("Date sheet civil-date regression passed")
    }
}
