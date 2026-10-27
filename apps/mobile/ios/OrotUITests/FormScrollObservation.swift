#if canImport(CoreGraphics)
    import CoreGraphics
#endif
import Foundation

/// Optional scalar-only runner evidence. It never decides exposure, retries a gesture or changes an assertion.
final class FormScrollObservation {
    enum Phase: String, Codable { case before, after, observed, firstStall, unknown }

    struct Record: Codable {
        let launch: UUID
        let reveal: Int
        let step: Int
        let phase: Phase
        let uptime: TimeInterval
        let target: [Double]?
        let start: [Double]?
        let end: [Double]?
    }

    /// Decode only the native fields needed for a conservative join; the full native file retains geometry separately.
    struct Touch: Decodable {
        struct Geometry: Decodable {
            let truncated: Bool
            let startMatches: Int
        }

        let launch: UUID
        let sequence: Int
        let touch: Int
        let phase: String
        let touchUptime: TimeInterval
        let capturedUptime: TimeInterval
        let point: [Double]
        let touchCount: Int
        let multipleTouches: Bool
        let geometry: Geometry
    }

    /// An offline consumer must retain UNKNOWN unless one complete native pair fits this exact runner bracket.
    /// Ended means after terminal touch dispatch, never after settled scrolling. Cancelled touches cannot establish a match.
    static func bind(_ touches: [Touch], dropped: Int, before: Record, after: Record) -> Int? {
        guard dropped == 0, before.phase == .before, after.phase == .after,
              before.launch == after.launch, before.reveal == after.reveal, before.step == after.step,
              before.uptime.isFinite, after.uptime.isFinite, before.uptime <= after.uptime,
              let start = before.start, let end = before.end, start == after.start, end == after.end
        else { return nil }
        let scoped = touches.filter { $0.launch == before.launch }
        let inside = scoped.filter {
            (before.uptime ... after.uptime).contains($0.touchUptime) || (before.uptime ... after.uptime).contains($0.capturedUptime)
        }
        guard Set(inside.map(\.touch)).count == 1, !inside.contains(where: { $0.touchCount != 1 || $0.multipleTouches }) else { return nil }
        let candidates = Dictionary(grouping: scoped, by: \.touch).values.filter { pair in
            guard pair.count == 2, let first = pair.first(where: { $0.phase == "began" }),
                  let last = pair.first(where: { $0.phase == "ended" }), first.sequence < last.sequence,
                  first.touchCount == 1, last.touchCount == 1, !first.multipleTouches, !last.multipleTouches,
                  !first.geometry.truncated, !last.geometry.truncated,
                  first.geometry.startMatches == 1, last.geometry.startMatches == 1
            else { return false }
            let times = [before.uptime, first.touchUptime, first.capturedUptime, last.touchUptime, last.capturedUptime, after.uptime]
            guard times.allSatisfy(\.isFinite), zip(times, times.dropFirst()).allSatisfy({ $0 <= $1 }) else { return false }
            return near(first.point, start) && near(last.point, end)
        }
        return candidates.count == 1 ? candidates.first?.first?.touch : nil
    }

    private static func near(_ observed: [Double], _ expected: [Double]) -> Bool {
        observed.count == 2 && expected.count == 2 && zip(observed, expected).allSatisfy {
            $0.isFinite && $1.isFinite && abs($0 - $1) <= 2
        }
    }

    private let launch: UUID
    private let reveal: Int
    private let emit: (Record) throws -> Void
    private var previous: (step: Int, target: CGRect?)?
    private var reportedStall = false

    init(launch: UUID, reveal: Int, emit: @escaping (Record) throws -> Void = log) {
        self.launch = launch
        self.reveal = reveal
        self.emit = emit
    }

    /// Called only after the original exposure predicate rejects the next already-read AX frame.
    /// Equality identifies a stalled observed target, not its cause or a native scroll-offset limit.
    func observed(_ target: CGRect?, completedSteps: Int) {
        record(.observed, step: completedSteps, target: target)
        if !reportedStall, let previous, previous.step == completedSteps,
           let target, target == previous.target
        {
            reportedStall = true
            record(.firstStall, step: completedSteps, target: target)
        }
    }

    /// Diagnostic failure is isolated from the exact original operation, which executes once even without an observer.
    static func around<T>(_ observer: FormScrollObservation?, step: Int, target: CGRect?, start: CGPoint, end: CGPoint,
                          operation: () throws -> T) rethrows -> T
    {
        observer?.previous = (step, target)
        observer?.record(.before, step: step, target: target, start: start, end: end)
        defer { observer?.record(.after, step: step, target: nil, start: start, end: end) }
        return try operation()
    }

    private func record(_ phase: Phase, step: Int, target: CGRect?, start: CGPoint? = nil, end: CGPoint? = nil) {
        let value = Record(launch: launch, reveal: reveal, step: step, phase: phase,
                           uptime: ProcessInfo.processInfo.systemUptime,
                           target: target.map { [Double($0.minX), Double($0.minY), Double($0.width), Double($0.height)] },
                           start: start.map { [Double($0.x), Double($0.y)] }, end: end.map { [Double($0.x), Double($0.y)] })
        do { try emit(value) } catch {
            // Never print an observer's private error or turn missing evidence into a product failure.
            print("OROT_FORM_SCROLL_UNKNOWN reveal=\(reveal) step=\(step)")
        }
    }

    static func log(_ value: Record) throws {
        let bytes = try JSONEncoder().encode(value)
        print("OROT_FORM_SCROLL_RUNNER \(String(decoding: bytes, as: UTF8.self))")
    }
}
