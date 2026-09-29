"use client";

import { useDeferredValue, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Section } from "@/components/ui/section";
import { useI18n } from "@/lib/i18n";
import { useAdminDomainCatalogQuery } from "@/lib/query/admin-hooks";

export function AdminDomainCatalogPanel({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [certification, setCertification] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const deferredCertification = useDeferredValue(certification.trim());
  const query = useAdminDomainCatalogQuery({ search: deferredSearch, certification: deferredCertification, page: 1 }, { enabled });

  return (
    <Section title={t("admin.domainCatalog.title")} description={t("admin.domainCatalog.subtitle")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.domainCatalog.certification")} htmlFor="admin-domain-certification">
          <Input id="admin-domain-certification" value={certification} onChange={(event) => setCertification(event.target.value)} />
        </Field>
        <Field label={t("admin.domainCatalog.search")} htmlFor="admin-domain-search">
          <Input id="admin-domain-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
      </div>

      {query.isPending && enabled ? (
        <p className="text-sm text-fg-muted" role="status">
          {t("common.status.loading")}
        </p>
      ) : query.isError ? (
        <QueryErrorBanner
          error={query.error}
          title={t("admin.domainCatalog.loadError")}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.data?.items.length ? (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {query.data.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-0.5 py-2.5">
              <span className="text-sm text-fg">
                {item.certification} · {item.domain}
                {item.subdomain ? ` · ${item.subdomain}` : ""}
              </span>
              <span className="text-xs text-fg-subtle">
                <span className="font-mono">{item.objective_code || "-"}</span> · <span className="font-mono">{item.blueprint_code || "-"}</span> ·{" "}
                {item.blueprint_title || item.title || "-"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="compact" description={t("admin.domainCatalog.empty")} />
      )}
    </Section>
  );
}
