import { Skeleton } from "@/components/ui/skeleton";

/** Neutral page placeholder used as a <Suspense> fallback (no translations needed). */
export function PageSkeleton({ blocks = [180, 320] }: { blocks?: number[] }) {
  return (
    <main className="sq-app-shell" aria-busy="true">
      <div className="sq-page-stack">
        {blocks.map((height, index) => (
          <Skeleton key={`${height}-${index}`} height={height} />
        ))}
      </div>
    </main>
  );
}
