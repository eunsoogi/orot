import CoreGraphics

@main
enum RoutesVisibleIntervalRegression {
    static func main() {
        precondition(RoutesVisibleInterval.revealDistance(overflow: 5, slack: 100, viewportHeight: 800) == 55)
        precondition(RoutesVisibleInterval.revealDistance(overflow: 500, slack: 100, viewportHeight: 800) == 320)
        precondition(RoutesVisibleInterval.advance(covered: 0, start: 0, end: 600, height: 1066) == 600)
        precondition(RoutesVisibleInterval.advance(covered: 600, start: 550, end: 1066, height: 1066) == 1066)
        precondition(RoutesVisibleInterval.advance(covered: 600, start: 602, end: 1066, height: 1066) == nil)
        precondition(RoutesVisibleInterval.advance(covered: 600, start: 500, end: 600, height: 1066) == nil)
        precondition(RoutesVisibleInterval.advance(covered: 0, start: 0, end: .nan, height: 1066) == nil)
    }
}
