import Foundation

/// Keeps observation overhead inside the original budget and persists the outcome before more AX work or fail-fast validation.
enum AuthConsentWait {
    struct Receipt<Result> {
        let result: Result
        let elapsedSeconds: Double
        let remainingSeconds: Double

        var metDeadline: Bool {
            elapsedSeconds <= 120
        }
    }

    static func observe<Result>(
        now: () -> Double,
        before: () -> Void,
        wait: (Double) -> Result,
        retain: (Receipt<Result>) -> Void,
        after: () throws -> Void,
        validate: (Receipt<Result>) throws -> Void,
    ) rethrows {
        let started = now()
        before()
        // A monotonic production clock should never move backwards. Clamping also prevents a supplied clock from extending the budget.
        let remaining = min(120, max(0, 120 - (now() - started)))
        let result = wait(remaining)
        let receipt = Receipt(result: result, elapsedSeconds: max(0, now() - started), remainingSeconds: remaining)
        retain(receipt)
        try after()
        try validate(receipt)
    }
}
