import Foundation

/// Runner phases share app uptime; the bracket alone does not prove native state or synthesized key delivery.
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

    #if OROT_TESTS
        /// Decode the app's test-only accessibility sample while preserving every scalar event field.
        struct UIKitSnapshot: Codable {
            struct Target: Codable {
                let matches: Int
                let truncated: Bool
                let length: Int?
                let location: Int?
                let selectionLength: Int?
                let focused: Bool?
                let keyWindow: Bool
                let inputIdentity: Int?
                let windowID: UUID?
            }

            enum NativePhase: String, Codable {
                case beforePress, afterPress, textChanged, beganEditing, endedEditing, reactReceipt, publicUIKitRead
            }

            enum NativeReactEvent: String, Codable { case changeText, controlledCommit }

            struct NativeEvent: Codable {
                let run: UUID
                let sequence: Int
                let step: Int
                let uptime: TimeInterval
                let phase: NativePhase
                let target: Target
                let reactEvent: NativeReactEvent?
                let reactSequence: Int?
                let reactLength: Int?
            }

            let run: UUID
            let sampleSequence: Int
            let sampleUptime: TimeInterval
            let target: Target
            let recentEvents: [NativeEvent]
            let eventBufferTruncated: Bool
        }
    #endif

    let run: UUID
    private var step = 0
    private var overflowReported = false
    /// Lets the immediately following UIKit attachment bind to the exact runner bracket.
    private(set) var lastRecord: Record?
    private let emit: (Record) throws -> Void

    init(run: UUID = UUID(), emit: @escaping (Record) throws -> Void = log) {
        self.run = run
        self.emit = emit
    }

    func record(_ phase: Phase) {
        lastRecord = nextRecord(phase)
    }

    private func nextRecord(_ phase: Phase) -> Record? {
        guard step < 4096 else {
            if !overflowReported {
                print("OROT_ENCOUNTER_INPUT_RUNNER_OVERFLOW")
                overflowReported = true
            }
            return nil
        }
        step += 1
        let record = Record(run: run, step: step, phase: phase, uptime: ProcessInfo.processInfo.systemUptime)
        do { try emit(record) }
        catch { print("OROT_ENCOUNTER_INPUT_RUNNER_UNKNOWN") }
        return record
    }

    private static func log(_ record: Record) throws {
        let data = try JSONEncoder().encode(record)
        print("OROT_ENCOUNTER_INPUT_RUNNER \(String(decoding: data, as: UTF8.self))")
    }
}

// Keep the scalar model host-compilable without XCTest; only the UI-test target adds attachments.
#if canImport(XCTest)
    import XCTest

    @MainActor extension EncounterInputObservation {
        private struct CapturedUIKitObservation: Encodable {
            let run: UUID
            let runner: Record?
            let snapshotStatus: String
            let runMatches: Bool?
            let publicUIKit: UIKitSnapshot?
        }

        /// Read the marker's public accessibility value now; the app computes it from live UIKit on demand.
        /// Attach only the typed scalar schema, never the raw AX label or any editor text.
        func captureUIKit(_ phase: Phase, app: XCUIApplication, testCase: XCTestCase) {
            record(phase)
            let runner = lastRecord
            let marker = app.descendants(matching: .any).matching(identifier: "visit-question-input-observation")
            let count = marker.count
            var snapshot: UIKitSnapshot?
            var status: String
            if count == 0 {
                status = "marker-missing"
            } else if count != 1 {
                status = "marker-ambiguous"
            } else if let raw = marker.firstMatch.value as? String,
                      let data = raw.data(using: .utf8),
                      let decoded = try? JSONDecoder().decode(UIKitSnapshot.self, from: data)
            {
                snapshot = decoded
                status = decoded.run == run ? "captured" : "run-mismatch"
            } else {
                status = "snapshot-unavailable"
            }
            let payload = CapturedUIKitObservation(
                run: run,
                runner: runner,
                snapshotStatus: status,
                runMatches: snapshot.map { $0.run == run },
                publicUIKit: snapshot,
            )
            do {
                let data = try JSONEncoder().encode(payload)
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "visit-question-input-\(phase.rawValue)"
                attachment.lifetime = .keepAlways
                testCase.add(attachment)
            } catch {
                print("OROT_ENCOUNTER_INPUT_ATTACHMENT_UNKNOWN")
            }
        }
    }
#endif
