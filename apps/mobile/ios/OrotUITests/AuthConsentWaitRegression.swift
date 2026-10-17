import Foundation

/// Runs the actual wait controller with a deterministic clock; it neither sleeps nor opens a system session.
enum AuthConsentWaitRegression {
    private enum Stop: Error { case failFast, unavailableSnapshot }

    @discardableResult
    static func verify(_ assertion: (Bool, String) -> Void) -> Int {
        var count = 0
        func check(_ condition: Bool, _ reason: String) {
            count += 1
            assertion(condition, reason)
        }
        for (times, expectedElapsed) in [
            ([10.0, 20], 10.0),
            ([100.0, 220], 120.0),
            ([10.0, 135], 125.0),
            ([100.0, 90], 0.0),
        ] {
            var clock = times
            var order: [String] = []
            do {
                try AuthConsentWait.observe(
                    now: { clock.removeFirst() },
                    before: { order.append("before") },
                    wait: {
                        order.append("wait")
                        return false
                    },
                    retain: { receipt in
                        order.append("retained")
                        check(!receipt.result, "A failed observation must remain a failure in its retained receipt")
                        check(receipt.elapsedSeconds == expectedElapsed, "Elapsed time must start before diagnostic observations")
                    },
                    after: { order.append("after") },
                    validate: { _ in
                        order.append("fail-fast")
                        throw Stop.failFast
                    },
                )
                check(false, "A fail-fast validation must prevent the remaining consent journey")
            } catch Stop.failFast {
                check(order == ["before", "wait", "retained", "after", "fail-fast"], "The failure receipt must precede post-wait AX work and the failing assertion")
            } catch {
                check(false, "Unexpected regression control error")
            }
        }
        var clock = [0.0, 120]
        var retained = false
        do {
            try AuthConsentWait.observe(
                now: { clock.removeFirst() }, before: {}, wait: { false },
                retain: { _ in retained = true },
                after: { throw Stop.unavailableSnapshot },
                validate: { _ in check(false, "An unavailable post-wait snapshot must not erase the prior receipt") },
            )
        } catch Stop.unavailableSnapshot {
            check(retained, "The failure receipt must already exist when a later AX observation fails")
        } catch {
            check(false, "Unexpected post-wait control error")
        }
        var successClock = [0.0, 3]
        var successOrder: [String] = []
        AuthConsentWait.observe(
            now: { successClock.removeFirst() }, before: {}, wait: { true },
            retain: { _ in successOrder.append("retained") }, after: {},
            validate: { receipt in
                successOrder.append("validated")
                check(receipt.result && receipt.elapsedSeconds == 3, "A completed wait must retain its real result and elapsed time")
            },
        )
        check(successOrder == ["retained", "validated"], "Successful observations must also be retained before validation")
        var lateClock = [0.0, 121]
        AuthConsentWait.observe(
            now: { lateClock.removeFirst() }, before: {}, wait: { true }, retain: { _ in }, after: {},
            validate: { receipt in
                check(receipt.result && receipt.elapsedSeconds == 121, "A slow successful observation remains successful with its actual elapsed time")
            },
        )
        return count
    }
}
