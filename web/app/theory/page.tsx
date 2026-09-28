import { TheoryReader } from "@/features/theory/components/theory-reader";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("theory", { robots: { index: false, follow: false } });

function takeFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

export default async function TheoryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <TheoryReader
      materialPath={takeFirst(params.material_path) || ""}
      locator={takeFirst(params.locator)}
      pageStart={takeFirst(params.page_start)}
      pageEnd={takeFirst(params.page_end)}
      label={takeFirst(params.label)}
    />
  );
}
