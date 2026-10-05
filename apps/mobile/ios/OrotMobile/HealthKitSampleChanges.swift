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
        return HealthKitSampleChangesRequest(feature: feature, sampleKind: sampleKind, limit: limit, cursor: cursor)
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
            reject("INVALID_REQUEST", "HealthKit sample changes query is invalid.", nil)
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
            reject("UNSUPPORTED_SAMPLE_KIND", "HealthKit sample kind is unsupported.", nil)
            return
        }

        let anchor: HKQueryAnchor?
        do {
            anchor = try HealthKitBoundary.decodeAnchor(request.cursor)
        } catch {
            reject("INVALID_CURSOR", "HealthKit query cursor is invalid.", error as NSError)
            return
        }
        let query = HKAnchoredObjectQuery(
            type: sampleType,
            predicate: nil,
            anchor: anchor,
            limit: request.limit,
        ) { _, samples, deletedObjects, newAnchor, error in
            if let error {
                reject("HEALTHKIT_QUERY_FAILED", error.localizedDescription, error as NSError)
                return
            }
            guard let samples, let deletedObjects else {
                reject("HEALTHKIT_QUERY_FAILED", "HealthKit returned no query result.", nil)
                return
            }
            do {
                let snapshots = try samples.map(HealthKitBoundary.snapshot)
                let cursor = try newAnchor.map(HealthKitBoundary.encodeAnchor) ?? request.cursor
                guard cursor != nil || (snapshots.isEmpty && deletedObjects.isEmpty) else {
                    reject("HEALTHKIT_SERIALIZATION_FAILED", "HealthKit returned changes without an anchor.", nil)
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
                reject("HEALTHKIT_SERIALIZATION_FAILED", error.localizedDescription, error as NSError)
            }
        }
        store.execute(query)
    }
}
