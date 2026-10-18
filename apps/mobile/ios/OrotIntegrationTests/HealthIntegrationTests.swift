import Foundation
import HealthKit
@testable import Orot
import XCTest

final class HealthIntegrationTests: OrotFailFastTestCase {
    func testAuthorizationScopesAndSyntheticSamplesStayExplicit() async throws {
        try verifyMedicationConsentRouting()
        let summary = try await run("healthkit")
        for field in ["authorizationPlan=feature-scoped", "writeTypes=0", "sampleTypes=passed", "syntheticSteps=passed", "unrelatedSleep=passed", "emptyQuery=completed", "realSamples=unverified"] {
            XCTAssertTrue(summary.contains(field), summary)
        }
        XCTAssertNotNil(summary.range(of: "availability=(available|unavailable)", options: .regularExpression))
    }

    private func verifyMedicationConsentRouting() throws {
        guard #available(iOS 26.0, *) else { return }
        let medication = HKObjectType.userAnnotatedMedicationType()
        let plan = try XCTUnwrap(HealthKitBatchAuthorization.plan(for: ["medications"]))
        XCTAssertTrue(medication.requiresPerObjectAuthorization())
        XCTAssertTrue(plan.shareTypes.isEmpty)
        XCTAssertTrue(plan.readTypes.isEmpty, "Medication and dose types must never reach sample authorization")
        XCTAssertEqual(plan.perObjectReadTypes, [medication])
        var phases: [String] = []
        HealthKitReadAuthorization.request(readTypes: plan.readTypes, perObjectReadTypes: plan.perObjectReadTypes,
                                           standard: { _, _ in XCTFail("Medication-only consent must not request sample authorization") },
                                           perObject: { type, finish in
                                               XCTAssertEqual(type, medication)
                                               phases.append("medication")
                                               finish(true, nil)
                                           }, completion: { success, error in
                                               XCTAssertTrue(success)
                                               XCTAssertNil(error)
                                               phases.append("complete")
                                           })
        XCTAssertEqual(phases, ["medication", "complete"])

        let mixed = try XCTUnwrap(HealthKitBatchAuthorization.plan(for: ["steps", "medications"]))
        XCTAssertEqual(mixed.readTypes, [HKObjectType.quantityType(forIdentifier: .stepCount)!])
        XCTAssertTrue(mixed.readTypes.allSatisfy { !$0.requiresPerObjectAuthorization() })
        var finishSamples: HealthKitReadAuthorization.Completion?
        var finishMedication: HealthKitReadAuthorization.Completion?
        phases = []
        HealthKitReadAuthorization.request(readTypes: mixed.readTypes, perObjectReadTypes: mixed.perObjectReadTypes,
                                           standard: { types, finish in
                                               XCTAssertEqual(types, mixed.readTypes)
                                               phases.append("samples")
                                               finishSamples = finish
                                           }, perObject: { type, finish in
                                               XCTAssertEqual(type, medication)
                                               phases.append("medication")
                                               finishMedication = finish
                                           }, completion: { success, error in
                                               XCTAssertFalse(success)
                                               XCTAssertNil(error)
                                               phases.append("cancelled")
                                           })
        XCTAssertEqual(phases, ["samples"], "The two HealthKit sheets must not overlap")
        try XCTUnwrap(finishSamples)(true, nil)
        XCTAssertEqual(phases, ["samples", "medication"])
        try XCTUnwrap(finishMedication)(false, nil)
        XCTAssertEqual(phases, ["samples", "medication", "cancelled"])

        let failure = NSError(domain: "HealthKitAuthorizationRegression", code: 1)
        HealthKitReadAuthorization.request(readTypes: mixed.readTypes, perObjectReadTypes: mixed.perObjectReadTypes,
                                           standard: { _, finish in finish(false, failure) },
                                           perObject: { _, _ in XCTFail("A failed first request must stop the consent sequence") },
                                           completion: { success, error in
                                               XCTAssertFalse(success)
                                               XCTAssertEqual(error as NSError?, failure)
                                           })
    }

    func testSyntheticSleepNormalizationAndAnchorResume() async throws {
        let summary = try await run("sleep-import")
        for field in ["stage=asleepUnspecified", "category=1", "interval=preserved", "anchorResume=passed", "anchoredNormalization=passed", "readAuthorization=notObservable", "source=synthetic", "realSamples=unverified"] {
            XCTAssertTrue(summary.contains(field), summary)
        }
        XCTAssertNotNil(summary.range(of: "availability=(available|unavailable)", options: .regularExpression))
        XCTAssertNotNil(summary.range(of: "sleepAuthorization=(completed|notRequested)", options: .regularExpression))
    }

    private func run(_ name: String) async throws -> String {
        // DEBUG supplies Simulator fixtures; these assertions cannot prove a physical device's sample access.
        let result = try await TestOperationBroker.shared.request(name)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        XCTAssertEqual(result["synthetic"] as? Bool, true)
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "health-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
        return try XCTUnwrap(result["summary"] as? String)
    }
}
