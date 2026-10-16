import Foundation

/// Retains the actual outcome before later AX diagnostics or fail-fast validation; elapsed time is diagnostic only.
enum AuthConsentWait {
    struct Receipt<Result> {
        let result: Result
        let elapsedSeconds: Double
    }

    static func observe<Result>(
        now: () -> Double,
        before: () -> Void,
        wait: () -> Result,
        retain: (Receipt<Result>) -> Void,
        after: () throws -> Void,
        validate: (Receipt<Result>) throws -> Void,
    ) rethrows {
        let started = now()
        before()
        let result = wait()
        let receipt = Receipt(result: result, elapsedSeconds: max(0, now() - started))
        retain(receipt)
        try after()
        try validate(receipt)
    }
}
