import Foundation
import HealthKit
import React

private let maximumHealthKitCursorLength = 1_000_000

/// Keeps feature and sample-kind identity beside the opaque HealthKit anchor.
struct HealthKitSampleChangesRequest {
    let feature: String
    let sampleKind: String
    let limit: Int
    let cursor: String?
    let resetAnchor: Bool
    let medicationConceptIdentifiers: Set<String>
}

extension HealthKitBoundary {
    static func decodeSampleChangesQuery(_ raw: NSDictionary) -> HealthKitSampleChangesRequest? {
        guard let value = raw as? [String: Any],
              let feature = value["feature"] as? String,
              let sampleKind = value["sampleKind"] as? String,
              let number = value["limit"] as? NSNumber
        else { return nil }
        let limit = number.intValue
        guard number.doubleValue == Double(limit), (1 ... 500).contains(limit),
              isValidSampleKind(sampleKind, for: feature)
        else { return nil }
        let cursor = value["cursor"] as? String
        guard value["cursor"] == nil || value["cursor"] is NSNull ||
            (cursor.map { !$0.isEmpty && $0.count <= maximumHealthKitCursorLength } ?? false)
        else { return nil }
        guard value["resetAnchor"] == nil ||
            (feature == "medications" && value["resetAnchor"] is Bool) else { return nil }
        let concepts = value["medicationConceptIdentifiers"] as? [String] ?? []
        guard value["medicationConceptIdentifiers"] == nil ||
            (feature == "medications" && value["medicationConceptIdentifiers"] is [String] &&
                concepts.allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } &&
                concepts.reduce(0) { $0 + $1.count } <= maximumHealthKitCursorLength) else { return nil }
        return HealthKitSampleChangesRequest(feature: feature, sampleKind: sampleKind, limit: limit, cursor: cursor,
                                             resetAnchor: value["resetAnchor"] as? Bool ?? false,
                                             medicationConceptIdentifiers: Set(concepts))
    }

    static func decodeAnchor(_ cursor: String?) throws -> HKQueryAnchor? {
        guard let cursor else { return nil }
        guard let data = Data(base64Encoded: cursor),
              let anchor = try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
        else { throw AnchorError.invalid }
        return anchor
    }

    static func encodeAnchor(_ anchor: HKQueryAnchor) throws -> String {
        let data = try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
        let cursor = data.base64EncodedString()
        guard cursor.count <= maximumHealthKitCursorLength else { throw AnchorError.invalid }
        return cursor
    }
}

public extension HealthKitModule {
    @objc(querySampleChanges:resolver:rejecter:)
    func querySampleChanges(_ raw: NSDictionary,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        guard let request = HealthKitBoundary.decodeSampleChangesQuery(raw) else {
            reject("INVALID_REQUEST", "Health record request is invalid.", nil)
            return
        }
        guard HealthKitBoundary.isSupported(request.feature) else {
            resolve(HealthKitBoundary.sampleChangesResult(availability: "unsupportedFeature", addedSamples: nil))
            return
        }
        #if DEBUG && targetEnvironment(simulator)
            if hasSyntheticFixture(for: request.feature) {
                resolve(HealthKitSimulatorFixture.sampleChanges(for: request))
                return
            }
        #endif
        guard HKHealthStore.isHealthDataAvailable() else {
            resolve(HealthKitBoundary.sampleChangesResult(availability: "unavailable", addedSamples: nil))
            return
        }
        guard let sampleType = HealthKitBoundary.sampleType(feature: request.feature, kind: request.sampleKind) else {
            reject("UNSUPPORTED_SAMPLE_KIND", "Selected health record type is not supported.", nil)
            return
        }
        withMedicationDoseScope(feature: request.feature, predicate: nil,
                                cursor: request.cursor, replay: request.resetAnchor,
                                retainedConcepts: request.medicationConceptIdentifiers)
        { scoped in
            guard case let .success(scope) = scoped else {
                if case .failure = scoped {
                    // Only stable bridge codes cross this boundary; native errors can contain private details.
                    reject("HEALTHKIT_QUERY_FAILED", "Health record query failed.", nil)
                }
                return
            }
            let anchor: HKQueryAnchor?
            do {
                anchor = try HealthKitBoundary.decodeAnchor(scope.cursor?.anchor ??
                    (request.feature == "medications" ? nil : request.cursor))
            } catch {
                reject("INVALID_CURSOR", "Health record cursor is invalid.", nil)
                return
            }
            let query = HKAnchoredObjectQuery(
                type: sampleType,
                predicate: scope.predicate,
                anchor: anchor,
                limit: request.limit,
            ) { _, samples, deletedObjects, newAnchor, error in
                if error != nil {
                    reject("HEALTHKIT_QUERY_FAILED", "Health record query failed.", nil)
                    return
                }
                guard let samples, let deletedObjects else {
                    reject("HEALTHKIT_QUERY_FAILED", "No health record changes were returned.", nil)
                    return
                }
                do {
                    let snapshots = try HealthKitBoundary.snapshotsWithDerivedShape(
                        samples,
                        feature: request.feature,
                        phase: .anchoredPage,
                    )
                    let rawAnchor = try newAnchor.map(HealthKitBoundary.encodeAnchor)
                    let cursor = try scope.cursor.map { try $0.encoded(anchor: rawAnchor ?? $0.anchor) } ??
                        rawAnchor ?? request.cursor
                    guard rawAnchor != nil || anchor != nil || (snapshots.isEmpty && deletedObjects.isEmpty) else {
                        reject("HEALTHKIT_SERIALIZATION_FAILED", "Health record changes could not be processed.", nil)
                        return
                    }
                    // A full bounded page may have more rows; an extra empty page proves the anchor is current.
                    let hasMore = snapshots.count + deletedObjects.count >= request.limit
                    resolve(HealthKitBoundary.sampleChangesResult(
                        availability: "available",
                        addedSamples: snapshots,
                        deletedSampleIDs: deletedObjects.map(\.uuid.uuidString),
                        cursor: cursor,
                        hasMore: hasMore,
                    ))
                } catch {
                    reject("HEALTHKIT_SERIALIZATION_FAILED", "Health record data could not be processed.", nil)
                }
            }
            self.store.execute(query)
        }
    }
}

extension HealthKitBoundary {
    /// A local opt-in observation of already-admitted query pages. Neither DTOs nor
    /// diagnostics contain extra IDs, times, quantities, or authorization inferences.
    static func snapshotsWithDerivedShape(
        _ samples: [HKSample],
        feature: String,
        phase: DerivedShapePhase,
    ) throws -> [[String: Any]] {
        let arguments = ProcessInfo.processInfo.arguments
        let flags = ["-OROT_PROVIDER_DIAGNOSTICS", "-OROT_DERIVED_HEART_RATE_SHAPE"]
        let isDerived = ["restingHeartRate", "walkingHeartRateAverage"].contains(feature)
        guard isDerived, flags.allSatisfy(arguments.contains) else { return try samples.map(snapshot) }

        var scalar = 0
        var series = 0
        var other = 0
        for sample in samples {
            let count = (sample as? HKQuantitySample)?.count ?? 0
            if count == 1 {
                scalar += 1
            } else if count > 1 {
                series += 1
            } else {
                other += 1
            }
        }
        var serialized = -1
        var summarized = -1
        defer {
            NSLog(
                "OROT_DERIVED_HEART_RATE_SHAPE phase=%@ feature=%@ scalar=%ld series=%ld other=%ld serialized=%ld summarized=%ld",
                phase.rawValue, feature, scalar, series, other, serialized, summarized,
            )
        }
        let results = try samples.map(snapshot)
        serialized = results.count
        summarized = results.reduce(into: 0) { count, item in
            if item["heartRateSampleSummary"] != nil {
                count += 1
            }
        }
        return results
    }

    enum DerivedShapePhase: String {
        case anchoredPage
        case boundedSnapshot
    }

    /// Discrete HealthKit series expose actual statistics. Never expand a scalar
    /// Apple resting/walking estimate or read any separate raw heart-rate type.
    static func derivedHeartRateSampleSummary(_ sample: HKQuantitySample, unit: HKUnit) -> [String: Any]? {
        let derivedTypeIDs = [
            HKQuantityTypeIdentifier.restingHeartRate.rawValue,
            HKQuantityTypeIdentifier.walkingHeartRateAverage.rawValue,
        ]
        guard derivedTypeIDs.contains(sample.quantityType.identifier),
              let discrete = sample as? HKDiscreteQuantitySample, (2 ... 1_000_000).contains(discrete.count) else { return nil }
        let minimum = discrete.minimumQuantity.doubleValue(for: unit)
        let maximum = discrete.maximumQuantity.doubleValue(for: unit)
        let mean = discrete.averageQuantity.doubleValue(for: unit)
        guard [minimum, maximum, mean].allSatisfy({ $0.isFinite && $0 > 0 }),
              minimum <= mean, mean <= maximum else { return nil }
        return ["value": mean, "heartRateSampleSummary": [
            "minimum": minimum, "maximum": maximum, "mean": mean, "count": discrete.count,
        ]]
    }
}
