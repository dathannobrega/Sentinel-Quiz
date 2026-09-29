import { Skeleton } from "@/components/ui/skeleton";
import { Page } from "@/components/ui/section";

/** Neutral page placeholder used as a <Suspense> fallback (no translations needed). */
export function PageSkeleton({ blocks = [72, 320] }: { blocks?: number[] }) {
  return (
    <Page aria-busy="true">
      {blocks.map((height, index) => (
        <Skeleton key={`${height}-${index}`} height={height} className={index === 0 ? "max-w-md" : undefined} />
      ))}
    </Page>
  );
}
