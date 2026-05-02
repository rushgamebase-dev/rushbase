export type ChartViewport = {
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  visibleMinPrice: number;
  visibleMaxPrice: number;
  visibleStartTime: number;
  visibleEndTime: number;
  nowTime: number;
};

function span(min: number, max: number) {
  return Math.max(1e-9, max - min);
}

export function xForTime(timestampMs: number, viewport: ChartViewport) {
  const t = (timestampMs - viewport.visibleStartTime) / span(
    viewport.visibleStartTime,
    viewport.visibleEndTime
  );
  return viewport.plotLeft + t * (viewport.plotRight - viewport.plotLeft);
}

export function yForPrice(price: number, viewport: ChartViewport) {
  const t = (price - viewport.visibleMinPrice) / span(
    viewport.visibleMinPrice,
    viewport.visibleMaxPrice
  );
  return viewport.plotBottom - t * (viewport.plotBottom - viewport.plotTop);
}

export function priceForY(y: number, viewport: ChartViewport) {
  const t = (viewport.plotBottom - y) / (viewport.plotBottom - viewport.plotTop);
  return viewport.visibleMinPrice + t * span(
    viewport.visibleMinPrice,
    viewport.visibleMaxPrice
  );
}

export function timeForX(x: number, viewport: ChartViewport) {
  const t = (x - viewport.plotLeft) / (viewport.plotRight - viewport.plotLeft);
  return viewport.visibleStartTime + t * span(
    viewport.visibleStartTime,
    viewport.visibleEndTime
  );
}
