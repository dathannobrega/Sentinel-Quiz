interface SkeletonProps {
  height?: number;
}

export function Skeleton({ height = 20 }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: "100%",
        height,
        borderRadius: 10,
        background:
          "linear-gradient(90deg, rgba(228,216,198,0.45) 25%, rgba(255,255,255,0.92) 50%, rgba(228,216,198,0.45) 75%)",
        backgroundSize: "200% 100%",
        animation: "sq-shimmer 1.4s linear infinite"
      }}
    />
  );
}
