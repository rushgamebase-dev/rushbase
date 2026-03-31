"use client";

// Usage:
// <Skeleton width={200} height={20} />
// <Skeleton className="rounded-full w-10 h-10" />
// <MarketCardSkeleton />

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className = "", width, height }: SkeletonProps) {
  const style: React.CSSProperties = {};
  if (width !== undefined) style.width = typeof width === "number" ? `${width}px` : width;
  if (height !== undefined) style.height = typeof height === "number" ? `${height}px` : height;

  return (
    <span
      className={`skeleton block rounded ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

export function MarketCardSkeleton() {
  return (
    <div
      className="card p-4 flex flex-col gap-3 animate-fade-in-up"
      aria-busy="true"
      aria-label="Loading market"
    >
      {/* Header row: icon + title */}
      <div className="flex items-start gap-3">
        <Skeleton width={36} height={36} className="rounded-lg shrink-0" />
        <div className="flex-1 flex flex-col gap-2">
          <Skeleton height={14} className="w-3/4" />
          <Skeleton height={12} className="w-1/2" />
        </div>
        {/* Hot badge placeholder */}
        <Skeleton width={40} height={18} className="rounded shrink-0" />
      </div>

      {/* Probability bars */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Skeleton width={32} height={11} />
          <Skeleton width={40} height={11} />
        </div>
        <Skeleton height={6} className="w-full rounded-full" />
        <div className="flex items-center justify-between">
          <Skeleton width={24} height={11} />
          <Skeleton width={40} height={11} />
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between pt-1">
        <Skeleton width={80} height={12} />
        <Skeleton width={60} height={12} />
        <Skeleton width={50} height={12} />
      </div>

      {/* CTA */}
      <Skeleton height={36} className="w-full rounded-md mt-1" />
    </div>
  );
}
