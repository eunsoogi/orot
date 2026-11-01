import Foundation

/// Exercises the same decoded payload and comparator that the UI geometry assertions consume.
@main
enum NavigationGeometryReservedRegionHostRegression {
    private typealias Matcher = NavigationGeometryReservedRegionMatcher
    private typealias Payload = Matcher.GeometryPayload
    private typealias Region = Matcher.GeometryRegion
    private typealias Rect = Matcher.GeometryRect
    private typealias Insets = Matcher.GeometryInsets

    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            throw NSError(domain: "NavigationGeometryReservedRegionHostRegression", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Pass the captured comparison fixture path."])
        }
        let fixture = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        let capture = try JSONDecoder().decode(CapturedComparison.self, from: fixture)
        let captured = capture.publicPayload.reservedRegions
        var failures = 0

        check("captured sample has duplicate identity and distinct frames", expected: true,
              actual: captured.count == 2 && captured[0].id == captured[1].id
                  && captured[0].kind == captured[1].kind && captured[0].frame.width != captured[1].frame.width,
              failures: &failures)
        check("captured payloads match through the production decoder", expected: true,
              actual: capture.publicPayload.matches(capture.native), failures: &failures)

        let reversed = payload(capture.native, replacing: Array(capture.native.reservedRegions.reversed()))
        check("captured regions match after order changes", expected: true,
              actual: capture.publicPayload.matches(reversed), failures: &failures)

        let overlapLeft = [
            region(captured[0], frame: Rect(x: 100, y: 0, width: 10, height: 10)),
            region(captured[0], frame: Rect(x: 100.4, y: 0, width: 10, height: 10)),
        ]
        let overlapRight = [
            region(captured[0], frame: Rect(x: 100.2, y: 0, width: 10, height: 10)),
            region(captured[0], frame: Rect(x: 99.7, y: 0, width: 10, height: 10)),
        ]
        check("overlapping tolerance candidates find a complete assignment", expected: true,
              actual: payload(capture.publicPayload, replacing: overlapLeft)
                  .matches(payload(capture.native, replacing: overlapRight)), failures: &failures)
        check("overlapping candidates remain order independent", expected: true,
              actual: payload(capture.publicPayload, replacing: Array(overlapLeft.reversed()))
                  .matches(payload(capture.native, replacing: Array(overlapRight.reversed()))), failures: &failures)

        let noPerfectAssignment = [
            region(captured[0], frame: Rect(x: 100.2, y: 0, width: 10, height: 10)),
            region(captured[0], frame: Rect(x: 101, y: 0, width: 10, height: 10)),
        ]
        check("one candidate cannot be reused for two duplicate identities", expected: false,
              actual: payload(capture.publicPayload, replacing: overlapLeft)
                  .matches(payload(capture.native, replacing: noPerfectAssignment)), failures: &failures)

        check("missing region is rejected", expected: false,
              actual: capture.publicPayload.matches(payload(capture.native,
                                                            replacing: Array(capture.native.reservedRegions.dropLast()))),
              failures: &failures)
        check("duplicate replacement is rejected", expected: false,
              actual: capture.publicPayload.matches(payload(capture.native,
                                                            replacing: [capture.native.reservedRegions[0],
                                                                        capture.native.reservedRegions[0]])),
              failures: &failures)

        let uniqueLeft = payload(capture.publicPayload, replacing: uniqueRegions(capture.publicPayload.reservedRegions))
        let uniqueRight = payload(capture.native, replacing: uniqueRegions(capture.native.reservedRegions))
        check("half-point frame rounding remains accepted", expected: true,
              actual: uniqueLeft.matches(payload(uniqueRight,
                                                 replacing: [region(uniqueRight.reservedRegions[0],
                                                                    frame: shifted(uniqueRight.reservedRegions[0].frame, x: 0.5)),
                                                             uniqueRight.reservedRegions[1]])), failures: &failures)
        check("frame difference beyond half a point is rejected", expected: false,
              actual: uniqueLeft.matches(payload(uniqueRight,
                                                 replacing: [region(uniqueRight.reservedRegions[0],
                                                                    frame: shifted(uniqueRight.reservedRegions[0].frame, x: 0.5001)),
                                                             uniqueRight.reservedRegions[1]])), failures: &failures)

        check("half-point safe-area inset rounding remains accepted", expected: true,
              actual: uniqueLeft.matches(payload(uniqueRight,
                                                 safeAreaInsets: shifted(uniqueRight.safeAreaInsets, right: 0.5))),
              failures: &failures)
        check("safe-area inset difference beyond half a point is rejected", expected: false,
              actual: uniqueLeft.matches(payload(uniqueRight,
                                                 safeAreaInsets: shifted(uniqueRight.safeAreaInsets, right: 0.5001))),
              failures: &failures)
        check("half-point region margin rounding remains accepted", expected: true,
              actual: uniqueLeft.matches(payload(uniqueRight,
                                                 replacing: [region(uniqueRight.reservedRegions[0],
                                                                    margins: shifted(uniqueRight.reservedRegions[0].margins,
                                                                                     right: 0.5)),
                                                             uniqueRight.reservedRegions[1]])), failures: &failures)

        check("region id change is rejected", expected: false,
              actual: uniqueLeft.matches(payload(uniqueRight,
                                                 replacing: [region(uniqueRight.reservedRegions[0], id: "changed"),
                                                             uniqueRight.reservedRegions[1]])), failures: &failures)
        check("region kind change is rejected", expected: false,
              actual: uniqueLeft.matches(payload(uniqueRight,
                                                 replacing: [region(uniqueRight.reservedRegions[0], kind: "division"),
                                                             uniqueRight.reservedRegions[1]])), failures: &failures)
        check("region activity change is rejected", expected: false,
              actual: uniqueLeft.matches(payload(uniqueRight,
                                                 replacing: [region(uniqueRight.reservedRegions[0], isActive: false),
                                                             uniqueRight.reservedRegions[1]])), failures: &failures)
        check("region margin change beyond half a point is rejected", expected: false,
              actual: uniqueLeft.matches(payload(uniqueRight,
                                                 replacing: [region(uniqueRight.reservedRegions[0],
                                                                    margins: shifted(uniqueRight.reservedRegions[0].margins,
                                                                                     right: 0.5001)),
                                                             uniqueRight.reservedRegions[1]])), failures: &failures)

        if failures > 0 {
            FileHandle.standardError.write(Data("\(failures) Swift geometry comparison case(s) failed.\n".utf8))
            exit(1)
        }
        print("PASS: 17 Swift geometry comparison cases")
    }

    private static func check(_ name: String, expected: Bool, actual: Bool, failures: inout Int) {
        let passed = expected == actual
        if !passed {
            failures += 1
        }
        print("\(passed ? "PASS" : "FAIL"): \(name)")
    }

    private static func payload(_ source: Payload, replacing regions: [Region]) -> Payload {
        Payload(windowBounds: source.windowBounds, safeAreaInsets: source.safeAreaInsets,
                reservedRegionsSupported: source.reservedRegionsSupported, reservedRegions: regions)
    }

    private static func payload(_ source: Payload, safeAreaInsets: Insets) -> Payload {
        Payload(windowBounds: source.windowBounds, safeAreaInsets: safeAreaInsets,
                reservedRegionsSupported: source.reservedRegionsSupported, reservedRegions: source.reservedRegions)
    }

    private static func uniqueRegions(_ regions: [Region]) -> [Region] {
        regions.enumerated().map { index, item in
            region(item, id: "region-\(index)")
        }
    }

    private static func region(_ source: Region, id: String? = nil, kind: String? = nil,
                               frame: Rect? = nil, margins: Insets? = nil, isActive: Bool? = nil) -> Region
    {
        Region(id: id ?? source.id, kind: kind ?? source.kind, frame: frame ?? source.frame,
               margins: margins ?? source.margins, isActive: isActive ?? source.isActive)
    }

    private static func shifted(_ source: Rect, x: Double) -> Rect {
        Rect(x: source.x + x, y: source.y, width: source.width, height: source.height)
    }

    private static func shifted(_ source: Insets, right: Double) -> Insets {
        Insets(top: source.top, right: source.right + right, bottom: source.bottom, left: source.left)
    }
}

private struct CapturedComparison: Decodable {
    let publicPayload: NavigationGeometryReservedRegionMatcher.GeometryPayload
    let native: NavigationGeometryReservedRegionMatcher.GeometryPayload

    private enum CodingKeys: String, CodingKey {
        case publicPayload = "public"
        case native
    }
}
