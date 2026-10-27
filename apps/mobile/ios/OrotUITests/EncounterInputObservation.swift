import Foundation

/// Optional runner-only brackets share system uptime with the app, but never claim a native snapshot or key delivery.
final class EncounterInputObservation {
    enum Phase: String, Codable {
        case beforeSelect, afterSelect, beforeDelete, afterDelete, afterEmptyAssertion, beforeType, afterType, afterValueAssertion
    }

    struct Record: Codable {
        let run: UUID
        let step: Int
        let phase: Phase
        let uptime: TimeInterval
    }

    let run: UUID
    private var step = 0
    private let emit: (Record) throws -> Void

    init(run: UUID = UUID(), emit: @escaping (Record) throws -> Void = log) {
        self.run = run
        self.emit = emit
    }

    func record(_ phase: Phase) {
        step += 1
        do { try emit(Record(run: run, step: step, phase: phase, uptime: ProcessInfo.processInfo.systemUptime)) }
        catch { print("OROT_ENCOUNTER_INPUT_RUNNER_UNKNOWN") }
    }

    private static func log(_ record: Record) throws {
        let data = try JSONEncoder().encode(record)
        print("OROT_ENCOUNTER_INPUT_RUNNER \(String(decoding: data, as: UTF8.self))")
    }
}
