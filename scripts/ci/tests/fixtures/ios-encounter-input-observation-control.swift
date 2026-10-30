import Foundation

/// Host-executable contract fixture for the test-only UIKit observation payload.
@main struct Control {
    @MainActor static func main() throws {
        let run = UUID()
        let suite = "encounter-observation-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        precondition(EncounterInputGate.session(defaults: defaults) == nil)
        defaults.set("private-recording-id", forKey: "OROT_TEST_ENCOUNTER_INPUT_OBSERVATION")
        precondition(EncounterInputGate.session(defaults: defaults) == nil)
        defaults.set(run.uuidString, forKey: "OROT_TEST_ENCOUNTER_INPUT_OBSERVATION")
        precondition(EncounterInputGate.session(defaults: defaults) == run)
        defaults.set("invalid", forKey: "OROT_TEST_FORM_OBSERVATION")
        precondition(EncounterInputGate.session(defaults: defaults) == run)
        defaults.set(UUID().uuidString, forKey: "OROT_TEST_FORM_OBSERVATION")
        precondition(EncounterInputGate.session(defaults: defaults) == nil)
        defaults.removeObject(forKey: "OROT_TEST_ENCOUNTER_INPUT_OBSERVATION")
        precondition(EncounterInputGate.session(defaults: defaults) == nil)

        var records: [EncounterInputTrace.Record] = []
        let trace = EncounterInputTrace(run: run) { records.append($0) }
        let selected = EncounterInputTrace.Target(matches: 1, truncated: false, length: 12, location: 0,
                                                  selectionLength: 12, focused: true, keyWindow: true,
                                                  inputIdentity: 1, windowID: run)
        let empty = EncounterInputTrace.Target(matches: 1, truncated: false, length: 0, location: 0,
                                               selectionLength: 0, focused: true, keyWindow: true,
                                               inputIdentity: nil, windowID: nil)
        trace.append(.beforePress, step: 1, target: selected)
        trace.append(.textChanged, step: 2, target: empty)
        trace.append(.afterPress, step: 1, target: empty)
        trace.append(.reactReceipt, step: 3, target: empty, reactEvent: .changeText, reactSequence: 1, reactLength: 0)
        trace.append(.publicUIKitRead, step: 1, target: selected)

        let snapshot = EncounterInputTrace.UIKitSnapshot(run: run, sampleSequence: 1,
                                                         sampleUptime: ProcessInfo.processInfo.systemUptime,
                                                         target: selected, recentEvents: trace.bufferedEvents,
                                                         eventBufferTruncated: trace.bufferedEventsTruncated)
        let snapshotData = try JSONEncoder().encode(snapshot)
        let snapshotObject = try JSONSerialization.jsonObject(with: snapshotData) as! [String: Any]
        precondition(Set(snapshotObject.keys) == Set(["run", "sampleSequence", "sampleUptime", "target", "recentEvents", "eventBufferTruncated"]))
        precondition(snapshotObject["run"] as? String == run.uuidString)
        precondition(snapshotObject["eventBufferTruncated"] as? Bool == false)
        let snapshotTarget = snapshotObject["target"] as! [String: Any]
        precondition(snapshotTarget["length"] as? Int == 12 && snapshotTarget["location"] as? Int == 0)
        precondition(snapshotTarget["selectionLength"] as? Int == 12 && snapshotTarget["focused"] as? Bool == true)
        let snapshotEvents = snapshotObject["recentEvents"] as! [[String: Any]]
        precondition(snapshotEvents.count == 5 && snapshotEvents.last?["phase"] as? String == "publicUIKitRead")
        let attachedSnapshot = try JSONDecoder().decode(EncounterInputObservation.UIKitSnapshot.self, from: snapshotData)
        precondition(attachedSnapshot.recentEvents.count == 5 && attachedSnapshot.eventBufferTruncated == false)
        let attachmentData = try JSONEncoder().encode(attachedSnapshot)
        precondition(String(decoding: attachmentData, as: UTF8.self).contains("publicUIKitRead"))
        precondition(!String(decoding: snapshotData, as: UTF8.self).contains("최근 증상 변화를 어떻게 정리할까요?"))
        precondition(records.map(\.sequence) == [1, 2, 3, 4, 5])
        precondition(records.map(\.step) == [1, 2, 1, 3, 1])
        precondition(records.allSatisfy { $0.run == run })
        precondition(zip(records, records.dropFirst()).allSatisfy { $0.uptime <= $1.uptime })
        let data = try JSONEncoder().encode(records)
        let decoded = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
        precondition(Set(decoded[0].keys) == Set(["run", "sequence", "step", "uptime", "phase", "target"]))
        precondition(Set((decoded[0]["target"] as! [String: Any]).keys) == Set(["matches", "truncated", "length", "location", "selectionLength", "focused", "keyWindow", "inputIdentity", "windowID"]))
        precondition(!String(decoding: data, as: UTF8.self).contains("private-recording-id"))

        let boundedTrace = EncounterInputTrace(run: run) { _ in }
        for sequence in 1 ... 257 {
            boundedTrace.append(.publicUIKitRead, step: sequence, target: selected)
        }
        precondition(boundedTrace.bufferedEvents.count == 256)
        precondition(boundedTrace.bufferedEvents.first?.sequence == 2)
        precondition(boundedTrace.bufferedEventsTruncated)

        let visitSuite = suite + "-visit-question"
        let visitDefaults = UserDefaults(suiteName: visitSuite)!
        defer { visitDefaults.removePersistentDomain(forName: visitSuite) }
        let visitRun = UUID()
        precondition(VisitQuestionInputGate.session(defaults: visitDefaults) == nil)
        visitDefaults.set(visitRun.uuidString, forKey: VisitQuestionInputGate.key)
        visitDefaults.set("wrong-scenario", forKey: "OROT_TEST_SCENARIO")
        visitDefaults.set("synthetic", forKey: "OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE")
        precondition(VisitQuestionInputGate.session(defaults: visitDefaults) == nil)
        visitDefaults.set("ai-feature-visit-questions", forKey: "OROT_TEST_SCENARIO")
        visitDefaults.set("production", forKey: "OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE")
        precondition(VisitQuestionInputGate.session(defaults: visitDefaults) == nil)
        visitDefaults.set("synthetic", forKey: "OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE")
        precondition(VisitQuestionInputGate.session(defaults: visitDefaults) == visitRun)
        visitDefaults.set(UUID().uuidString, forKey: "OROT_TEST_FORM_OBSERVATION")
        precondition(VisitQuestionInputGate.session(defaults: visitDefaults) == nil)
        visitDefaults.removeObject(forKey: "OROT_TEST_FORM_OBSERVATION")
        visitDefaults.set(UUID().uuidString, forKey: "OROT_TEST_ENCOUNTER_INPUT_OBSERVATION")
        precondition(VisitQuestionInputGate.session(defaults: visitDefaults) == nil)

        let failure = NSError(domain: "private-health-error", code: 7)
        var attempts = 0
        let throwing = EncounterInputTrace(run: run) { _ in attempts += 1; throw failure }
        throwing.append(.beforePress, step: 1, target: selected)
        throwing.append(.afterPress, step: 1, target: empty)
        precondition(attempts == 2)
        for index in 5 ... 4100 {
            trace.append(.textChanged, step: index, target: empty)
        }
        precondition(records.count == 4096)

        var runner: [EncounterInputObservation.Record] = []
        let bracket = EncounterInputObservation(run: run) { runner.append($0) }
        bracket.record(.beforeSelect)
        bracket.record(.afterSelect)
        bracket.record(.beforeDelete)
        bracket.record(.afterDelete)
        precondition(runner.map(\.step) == [1, 2, 3, 4])
        precondition(runner.allSatisfy { $0.run == run })
        let broken = EncounterInputObservation(run: run) { _ in throw failure }
        broken.record(.beforeSelect)
        broken.record(.afterSelect)
        print("scalar-controls-pass")
    }
}
