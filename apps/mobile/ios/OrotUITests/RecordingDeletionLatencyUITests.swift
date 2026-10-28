import UIKit
import XCTest

/// Captures timing distributions by deleting fresh synthetic recordings through the production screen.
final class RecordingDeletionLatencyUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testSyntheticRecordingDeletionTimingDistribution() throws {
        let sampleCount = 10
        var samples: [[String: Any]] = []
        for _ in 0 ..< sampleCount {
            try samples.append(measureSyntheticDeletion())
        }
        verifyDeletionPersistsAfterRestart()

        let environment = ProcessInfo.processInfo.environment
        let runKind = environment["TEST_RUNNER_RECORDING_DELETION_RUN_KIND"] ?? "unclassified"
        let sourceRevision = environmentValue(
            ["TEST_RUNNER_SOURCE_REVISION", "OROT_RECORDING_DELETION_SOURCE_REVISION", "GITHUB_SHA"],
            environment: environment,
        )
        let appVersion = environmentValue(
            ["TEST_RUNNER_APP_VERSION", "OROT_RECORDING_DELETION_APP_VERSION"],
            environment: environment,
        )
        let appBuild = environmentValue(
            ["TEST_RUNNER_APP_BUILD", "OROT_RECORDING_DELETION_APP_BUILD"],
            environment: environment,
        )
        let simulatorUDID = environmentValue(
            ["TEST_RUNNER_SIMULATOR_UDID", "SIMULATOR_UDID"],
            environment: environment,
        )
        let simulatorModel = environmentValue(
            ["TEST_RUNNER_SIMULATOR_MODEL", "SIMULATOR_MODEL_IDENTIFIER", "SIMULATOR_DEVICE_NAME"],
            environment: environment,
        )
        if runKind == "baseline" || runKind == "after" {
            XCTAssertNotEqual(sourceRevision, "unavailable", "A measurement run must record its source revision.")
            XCTAssertNotEqual(appVersion, "unavailable", "A measurement run must record its app version.")
            XCTAssertNotEqual(appBuild, "unavailable", "A measurement run must record its app build.")
            XCTAssertNotEqual(simulatorUDID, "unavailable", "A measurement run must record its Simulator UDID.")
            XCTAssertNotEqual(simulatorModel, "unavailable", "A measurement run must record its Simulator model.")
        }
        let report: [String: Any] = [
            "schema": "orot.recording-deletion-run.v1",
            "runKind": runKind,
            "sourceRevision": sourceRevision,
            "appVersion": appVersion,
            "appBuild": appBuild,
            "simulator": [
                "udid": simulatorUDID,
                "model": simulatorModel,
                "runtimeVersion": UIDevice.current.systemVersion,
            ],
            "fixture": "Synthetic transcription test recording",
            "conditions": [
                "sampleCount": sampleCount,
                "screen": "production RecordingScreen and saved-recordings list",
                "deletePath": "list-row confirmation and committed row removal",
                "observer": "opt-in monotonic stage timings; no recording identity or content",
                "restartPersistence": "verified absent after relaunch without fixture reseed",
            ],
            "distributionsMs": summarize(samples),
            "samples": samples,
        ]
        let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "recording-deletion-timing-distribution"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func measureSyntheticDeletion() throws -> [String: Any] {
        let app = XCUIApplication()
        RecordingFixtureUITestConditions.launch(
            app,
            extra: ["-OROT_RECORDING_DELETION_TIMING", "YES"],
        )
        defer {
            if app.state != .notRunning {
                app.terminate()
            }
        }

        let openSaved = UITestConditions.element(app, "recording-open-saved")
        XCTAssertTrue(openSaved.waitForAppearance(), app.debugDescription)
        openSaved.tap()
        XCTAssertTrue(
            UITestConditions.exists(UITestConditions.element(app, "recording-library-panel")),
            app.debugDescription,
        )

        let row = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", "Synthetic transcription test recording"),
        ).firstMatch
        FormUITestConditions.reveal(row, in: app, scrollID: "recording-controls-scroll")
        XCTAssertTrue(row.identifier.hasPrefix("recording-details-"), row.debugDescription)
        let sourceId = String(row.identifier.dropFirst("recording-details-".count))
        XCTAssertNotNil(UUID(uuidString: sourceId), row.debugDescription)

        let delete = UITestConditions.element(app, "recording-delete-\(sourceId)")
        FormUITestConditions.reveal(delete, in: app, scrollID: "recording-controls-scroll")
        XCTAssertTrue(delete.isHittable, delete.debugDescription)
        delete.tap()

        let confirmation = app.alerts.firstMatch
        XCTAssertTrue(confirmation.waitForAppearance(), app.debugDescription)
        XCTAssertEqual(confirmation.buttons.count, 2, confirmation.debugDescription)
        confirmation.buttons.element(boundBy: 1).tap()

        let report = UITestConditions.element(app, "recording-deletion-timing-report")
        XCTAssertTrue(report.waitForAppearance(), app.debugDescription)
        let reportReady = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label != %@", "pending"),
            object: report,
        )
        XCTAssertEqual(XCTWaiter.wait(for: [reportReady], timeout: 60), .completed, app.debugDescription)
        let encoded = UITestConditions.text(report)
        XCTAssertFalse(encoded.contains(sourceId), "Timing reports must not contain a recording identity.")
        let data = try XCTUnwrap(encoded.data(using: .utf8))
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(result["schema"] as? String, "orot.recording-deletion-timing.v1")
        XCTAssertEqual(result["complete"] as? Bool, true, encoded)
        XCTAssertEqual(result["succeeded"] as? Bool, true, encoded)
        XCTAssertFalse(UITestConditions.element(app, "recording-library-item-\(sourceId)").exists)
        return result
    }

    @MainActor
    private func verifyDeletionPersistsAfterRestart() {
        let app = XCUIApplication()
        RecordingFixtureUITestConditions.launch(
            app,
            extra: ["-OROT_RECORDING_DELETION_PERSISTENCE_PROBE", "YES"],
        )
        defer {
            if app.state != .notRunning {
                app.terminate()
            }
        }

        let persistence = UITestConditions.element(app, "recording-deletion-persistence-status")
        XCTAssertTrue(persistence.waitForAppearance(), app.debugDescription)
        UITestConditions.value(persistence, equals: "absent")
        UITestConditions.element(app, "recording-open-saved").tap()
        XCTAssertTrue(
            UITestConditions.exists(UITestConditions.element(app, "recording-library-panel")),
            app.debugDescription,
        )
        XCTAssertTrue(
            UITestConditions.element(app, "recording-library-empty").waitForAppearance(),
            app.debugDescription,
        )
    }

    /// Uses linear interpolation so baseline and after-run percentiles share one rank convention.
    private func summarize(_ samples: [[String: Any]]) -> [String: [String: Double]] {
        let stages = [
            "confirmationToProgress",
            "sourceRead",
            "stopCheck",
            "audioStaging",
            "memoryOpen",
            "derivedDataCleanup",
            "databaseDeleteCommit",
            "audioCleanup",
            "audioCleanupToListRefresh",
            "confirmationToListRefresh",
        ]
        var summary: [String: [String: Double]] = [:]
        for stage in stages {
            let values = samples.compactMap { sample -> Double? in
                guard let durations = sample["durationsMs"] as? [String: Any] else { return nil }
                return durations[stage] as? Double
            }.sorted()
            guard values.count == samples.count, !values.isEmpty else { continue }
            summary[stage] = ["p50": percentile(values, fraction: 0.5), "p90": percentile(values, fraction: 0.9)]
        }
        return summary
    }

    private func percentile(_ sortedValues: [Double], fraction: Double) -> Double {
        let position = Double(sortedValues.count - 1) * fraction
        let lowerIndex = Int(floor(position))
        let upperIndex = Int(ceil(position))
        let interpolation = position - Double(lowerIndex)
        return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * interpolation
    }

    private func environmentValue(_ keys: [String], environment: [String: String]) -> String {
        keys.compactMap { environment[$0] }.first ?? "unavailable"
    }
}
