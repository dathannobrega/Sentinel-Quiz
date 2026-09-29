import { Page } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function Loading() {
  const { t } = await getServerTranslator();

  return (
    <Page aria-busy="true">
      <span className="sr-only" role="status">
        {t("system.loading")}
      </span>
      <Skeleton height={56} className="max-w-sm" />
      <Skeleton height={200} />
      <Skeleton height={120} />
    </Page>
  );
}
