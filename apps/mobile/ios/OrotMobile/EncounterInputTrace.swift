import Foundation

/// SceneDelegate gives HealthReview and visit-question observation windows precedence.
/// Invalid or missing Encounter flags never enable the bridge, notifications or window subclass.
enum EncounterInputGate {
    static func session(defaults: UserDefaults = .standard) -> UUID? {
        guard defaults.string(forKey: "OROT_TEST_FORM_OBSERVATION").flatMap(UUID.init(uuidString:)) == nil else { return nil }
        return defaults.string(forKey: "OROT_TEST_ENCOUNTER_INPUT_OBSERVATION").flatMap(UUID.init(uuidString:))
    }
}

/// Only scalar state and run/window UUIDs escape UIKit; lengths and ranges use UTF-16 code units.
@MainActor final class EncounterInputTrace {
    enum Phase: String, Codable { case beforePress, afterPress, textChanged, beganEditing, endedEditing, reactReceipt }
    enum ReactEvent: String, Codable { case changeText, controlledCommit }
    struct Target: Codable {
        let matches: Int
        let truncated: Bool
        let length: Int?
        let location: Int?
        let selectionLength: Int?
        let focused: Bool?
        let keyWindow: Bool
        /// These identities contain no UI object or text and are set only by the visit-question observer.
        let inputIdentity: Int?
        let windowID: UUID?
    }

    struct Record: Codable {
        let run: UUID
        let sequence: Int
        let step: Int
        let uptime: TimeInterval
        let phase: Phase
        let target: Target
        let reactEvent: ReactEvent?
        let reactSequence: Int?
        let reactLength: Int?
    }

    private let run: UUID
    private var sequence = 0
    private let emit: @MainActor (Record) throws -> Void
    private var overflowReported = false

    init(run: UUID, emit: @escaping @MainActor (Record) throws -> Void = log) {
        self.run = run
        self.emit = emit
    }

    /// A throwing sink preserves event delivery; overflow explicitly makes later coverage unknown.
    func append(_ phase: Phase, step: Int, target: Target, reactEvent: ReactEvent? = nil, reactSequence: Int? = nil, reactLength: Int? = nil) {
        guard sequence < 4096 else {
            if !overflowReported {
                print("OROT_ENCOUNTER_INPUT_OVERFLOW"); overflowReported = true
            }
            return
        }
        sequence += 1
        let record = Record(run: run, sequence: sequence, step: step, uptime: ProcessInfo.processInfo.systemUptime,
                            phase: phase, target: target, reactEvent: reactEvent, reactSequence: reactSequence, reactLength: reactLength)
        do { try emit(record) } catch { print("OROT_ENCOUNTER_INPUT_UNKNOWN") }
    }

    static func log(_ record: Record) throws {
        let bytes = try JSONEncoder().encode(record)
        print("OROT_ENCOUNTER_INPUT_NATIVE \(String(decoding: bytes, as: UTF8.self))")
    }
}
