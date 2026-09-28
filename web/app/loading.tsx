import { Skeleton } from "@/components/ui/skeleton";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function Loading() {
  const { t } = await getServerTranslator();

  return (
    <main className="sq-app-shell" aria-busy="true">
      <div className="sq-page-stack" role="status">
        <span className="sq-visually-hidden">{t("system.loading")}</span>
        <Skeleton height={180} />
        <Skeleton height={320} />
      </div>
    </main>
  );
}
