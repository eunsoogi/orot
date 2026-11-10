#import <XCTest/XCTest.h>
#import <RNSVG/RCTConvert+RNSVG.h>
#import <RNSVG/RNSVGTSpan.h>
#import <react/renderer/components/rnsvg/Props.h>

using namespace facebook::react;

@interface SVGFoundationIntegrationTests : XCTestCase
@end

@implementation SVGFoundationIntegrationTests

// Exercise real Fabric props on one native object through update, reset, and reuse.
- (void)testTextPropsAndGradientStorageSurviveNativeReuse {
    void (^exercise)(void) = ^{
      RNSVGTSpan *span = [[RNSVGTSpan alloc] initWithFrame:CGRectZero];
      RNSVGTSpan *sameSpan = span;
      auto first = std::make_shared<RNSVGTSpanProps>();
      first->content = "first";
      first->opacity = 0.5;
      static_cast<ViewProps &>(*first).opacity = 0.4;
      Props::Shared firstProps = first;
      [span updateProps:firstProps oldProps:firstProps];
      XCTAssertEqualObjects(span.content, @"first");
      XCTAssertEqualWithAccuracy(span.opacity, 0.5, 0.001);
      XCTAssertEqualWithAccuracy(span.layer.opacity, 0.4, 0.001);

      auto empty = std::make_shared<RNSVGTSpanProps>();
      Props::Shared emptyProps = empty;
      [span updateProps:emptyProps oldProps:firstProps];
      XCTAssertNil(span.content);
      XCTAssertEqualWithAccuracy(span.layer.opacity, 1.0, 0.001);
      [span updateProps:firstProps oldProps:emptyProps];
      XCTAssertEqualObjects(span.content, @"first");
      [span prepareForRecycle];
      XCTAssertNil(span.content);

      auto second = std::make_shared<RNSVGTSpanProps>();
      second->content = "second";
      static_cast<ViewProps &>(*second).opacity = 0.7;
      Props::Shared secondProps = second;
      [span updateProps:secondProps oldProps:firstProps];
      XCTAssertTrue(span == sameSpan);
      XCTAssertEqualObjects(span.content, @"second");
      XCTAssertEqualWithAccuracy(span.layer.opacity, 0.7, 0.001);

      // Empty gradient input must not dereference an empty vector.
      XCTAssertEqual([RCTConvert RNSVGCGGradient:@[]], nullptr);
      CGGradientRef gradient = [RCTConvert RNSVGCGGradient:@[ @0, @0xFFFF0000, @1, @0xFF00FF00 ]];
      XCTAssertNotEqual(gradient, nullptr);
    };
    if (NSThread.isMainThread)
        exercise();
    else
        dispatch_sync(dispatch_get_main_queue(), exercise);
}

@end
