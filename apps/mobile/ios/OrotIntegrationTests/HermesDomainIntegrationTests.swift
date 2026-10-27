import Foundation
@testable import Orot
import XCTest

final class HermesDomainIntegrationTests: OrotFailFastTestCase {
    /// Real classifier, scripted responses: counts local overhead and provider dispatches, not inference time.
    func testLargeCalendarClassificationReportsProgressAndCancellation() async throws {
        let result = try await operation("ai-scale-calendar")
        XCTAssertEqual(result["scriptedModel"] as? Bool, true)
        let runs = try XCTUnwrap(result["runs"] as? [[String: Any]])
        XCTAssertEqual(runs.count, 4)
        for run in runs.prefix(3) {
            if run["timeBudgetExceeded"] as? Bool == true {
                XCTAssertEqual(run["status"] as? String, "partial")
            } else {
                XCTAssertEqual(run["status"] as? String, "complete")
            }
        }
        XCTAssertEqual(runs.last?["completedBatches"] as? Int, 1)
    }

    /// Measures real encrypted local retrieval, never an actual model or user account.
    func testLargeMixedLibraryMeasuresBoundedAiPreparation() async throws {
        let result = try await operation("ai-scale", parameters: ["fixtureIdentifier": "test-ai-scale-\(UUID().uuidString)"])
        XCTAssertEqual(result["encrypted"] as? Bool, true)
        XCTAssertEqual(result["modelInvoked"] as? Bool, false)
        let scales = try XCTUnwrap(result["scales"] as? [[String: Any]])
        XCTAssertEqual(scales.count, 3)
        for scale in scales {
            XCTAssertEqual(scale["cancellationRejected"] as? Bool, true)
            let sql = try XCTUnwrap(scale["sql"] as? [String: Any])
            XCTAssertLessThanOrEqual(try XCTUnwrap(sql["maximumPayloadPage"] as? Int), 100)
        }
    }

    func testHostExecutesHermesOperations() async throws {
        let result = try await operation("connection")
        XCTAssertEqual(result["connected"] as? Bool, true)
    }

    func testTwentyGraphInvocationsAndStreams() async throws {
        let result = try await operation("graph")
        XCTAssertEqual(result["invocations"] as? Int, 20)
        XCTAssertEqual(result["streams"] as? Int, 20)
        XCTAssertEqual(result["duplicateNodes"] as? Int, 0)
    }

    /// Runs the production workflow graph with scripted model and local-search responses only.
    func testWorkflowProgressProjectsBufferedRuntimeEvents() async throws {
        let result = try await operation("workflow-progress")
        XCTAssertEqual(result["synthetic"] as? Bool, true)
        XCTAssertEqual(result["modelExecution"] as? String, "scripted")
        XCTAssertEqual(result["actualModel"] as? String, "not-run")
        XCTAssertEqual(result["successStatus"] as? String, "result")
        XCTAssertEqual(result["successProgress"] as? [String], [
            "model_started:task_response",
            "model_started:evidence_research",
            "evidence_search:started:personal_record",
            "evidence_search:completed:personal_record",
            "model_started:revised_response",
        ])
        XCTAssertEqual(result["projectedText"] as? String, "Synthetic answer.")
        XCTAssertEqual(result["streamTypes"] as? [String], ["started", "started", "text_delta"])
        XCTAssertEqual(result["partialVisibleBeforeCompletion"] as? Bool, false)
        XCTAssertEqual(result["privatePayloadExposed"] as? Bool, false)
    }

    func testLargeHealthLibraryUsesDefaultPagesAndStableCursors() async throws {
        let result = try await operation("health-pagination", parameters: ["fixtureIdentifier": "test-pagination-\(UUID().uuidString)"])
        XCTAssertEqual(result["encrypted"] as? Bool, true)
        XCTAssertEqual(result["recordCount"] as? Int, 1503)
        XCTAssertEqual(result["pageCount"] as? Int, 31)
        XCTAssertEqual(result["defaultPageSize"] as? Int, 50)
        XCTAssertEqual(result["secondPageValue"] as? String, "85 count/min")
        XCTAssertEqual(result["tiedTimestamps"] as? Bool, true)
        XCTAssertEqual(result["deletedCursorAndNewerArrival"] as? Bool, true)
    }

    func testSourceLinkedLocalQueriesRemoveTheirSyntheticFixtures() async throws {
        let result = try await operation("local-query", parameters: ["queryIdentifier": "test-query-\(UUID().uuidString)"])
        XCTAssertEqual(result["synthetic"] as? Bool, true)
        XCTAssertEqual(result["summary"] as? String,
                       "healthQueries=5; healthRecords=6; bloodPressure=2; sleep=asleepDeep; dose=not_logged; medication=timeBasis:local_ingest; appointment=confirmed; transcript=source-linked; cipher=available; wrongKey=rejected; cleanup=true")
    }

    /// Uses real SQLCipher period queries and Hermes calendar handling; no HealthKit or model request occurs.
    func testLongitudinalHealthContextPreservesCoverageAndInvalidatesDeletion() async throws {
        let result = try await operation("health-context", parameters: ["fixtureIdentifier": "test-health-context-\(UUID().uuidString)"])
        XCTAssertEqual(result["encrypted"] as? Bool, true)
        XCTAssertEqual(result["synthetic"] as? Bool, true)
        XCTAssertEqual(result["calendarDays"] as? Int, 4)
        XCTAssertEqual(result["firstDate"] as? String, "2026-10-01")
        XCTAssertEqual(result["pressureDays"] as? Int, 3)
        XCTAssertEqual(result["pressureSamples"] as? Int, 6)
        XCTAssertEqual(result["pressureDailyMeans"] as? [Int], [131, 133, 134])
        XCTAssertEqual(result["bodyMass"] as? Double, 70.5)
        XCTAssertEqual(result["stepSums"] as? [Int], [800, 1600])
        let medication = try XCTUnwrap(result["medication"] as? [String: Any])
        XCTAssertEqual(medication["scheduleRegistered"] as? Bool, true)
        XCTAssertEqual(medication["taken"] as? Int, 1)
        XCTAssertEqual(medication["skipped"] as? Int, 0)
        XCTAssertEqual(medication["otherDoseRecords"] as? Int, 1)
        XCTAssertEqual(medication["daysWithDoseRecords"] as? Int, 2)
        let sleep = try XCTUnwrap(result["sleep"] as? [String: Any])
        XCTAssertEqual(sleep["asleepSeconds"] as? Int, 5400)
        XCTAssertEqual(sleep["overlappingStageSeconds"] as? Int, 1800)
        let symptoms = try XCTUnwrap(result["symptoms"] as? [String: Any])
        XCTAssertEqual(symptoms["entryCount"] as? Int, 1)
        XCTAssertEqual((symptoms["latest"] as? [[String: Any]])?.first?["severity"] as? Int, 3)
        XCTAssertEqual(result["cacheReused"] as? Bool, true)
        XCTAssertEqual(result["deletionInvalidated"] as? Bool, true)
        XCTAssertEqual(result["tempStore"] as? Int, 2)
        XCTAssertLessThan(try XCTUnwrap(result["projectedBytes"] as? Int), 12000)
        XCTAssertEqual(result["longWindowDays"] as? Int, 90)
        XCTAssertLessThan(try XCTUnwrap(result["longProjectedBytes"] as? Int), 12000)
        XCTAssertEqual(result["exactBoundarySums"] as? [Int], [2, 4])
        XCTAssertEqual(result["exactPartialDays"] as? Bool, true)
    }

    func testEncryptedSourceEvidenceAndRagRelationships() async throws {
        let parameters = ["storageIdentifier": "test-storage-\(UUID().uuidString)"]
        let created = try await operation("storage-create", parameters: parameters)
        XCTAssertEqual(created["encrypted"] as? Bool, true)
        XCTAssertEqual(created["wrongKeyRejected"] as? Bool, true)
        let restored = try await operation("storage-read", parameters: parameters)
        XCTAssertEqual(restored["sourceAndEvidenceRestored"] as? Bool, true)
        XCTAssertEqual(restored["ragChunksVerified"] as? Bool, true)
    }

    /// Reopens the encrypted file and verifies that deleting a period input purges its saved derived text.
    func testComputedPeriodSummaryRestoresAndPurgesDeletedInputs() async throws {
        let result = try await operation("health-context-persistence", parameters: ["fixtureIdentifier": "test-period-summary-\(UUID().uuidString)"])
        for key in ["encrypted", "reloaded", "periodSourceAvailable", "unrelatedDeletePreserved", "summaryPurged", "evidenceInvalidated"] {
            XCTAssertEqual(result[key] as? Bool, true, key)
        }
        XCTAssertEqual(result["sourceChanged"] as? Bool, false)
        XCTAssertEqual(result["periodRowsAfterDeletion"] as? Int, 0)
    }

    /// Exercises standard indexing and both retrieval children before checking durable deletion fences.
    func testMemoryDeletionKeepsTombstonesAndRemovesSearchEvidence() async throws {
        let parameters = ["fixtureIdentifier": "test-memory-\(UUID().uuidString)"]
        _ = try await operation("memory-create", parameters: parameters)
        let deleted = try await operation("memory-delete", parameters: parameters)
        XCTAssertEqual(deleted["removed"] as? Bool, true)
        XCTAssertEqual(deleted["standardRagPositiveControl"] as? Bool, true)
        let tombstone = try await operation("memory-tombstone", parameters: parameters)
        XCTAssertEqual(tombstone["tombstoneVerified"] as? Bool, true)
        let absent = try await operation("memory-verify-deletion", parameters: parameters)
        XCTAssertEqual(absent["absentFromMemoryAndSearch"] as? Bool, true)
        XCTAssertEqual(absent["standardRagDeletionFence"] as? Bool, true)
    }

    private func operation(_ name: String, parameters: [String: Any] = [:]) async throws -> [String: Any] {
        let result = try await TestOperationBroker.shared.request(name, parameters: parameters)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "hermes-domain-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
        return result
    }
}
