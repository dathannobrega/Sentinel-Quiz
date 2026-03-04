"use client";

import { useState } from "react";

import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n";
import { useAdminDomainCatalogQuery } from "@/lib/query/hooks";

export function AdminDomainCatalogPanel() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [certification, setCertification] = useState("");
  const query = useAdminDomainCatalogQuery({ search, certification, page: 1 });

  return (
    <Card title={t("admin.domainCatalog.title")} subtitle={t("admin.domainCatalog.subtitle")}>
      <div className="sq-form-grid">
        <Field label={t("admin.domainCatalog.certification")} htmlFor="admin-domain-certification">
          <input
            id="admin-domain-certification"
            className="sq-input"
            value={certification}
            onChange={(event) => setCertification(event.target.value)}
          />
        </Field>
        <Field label={t("admin.domainCatalog.search")} htmlFor="admin-domain-search">
          <input
            id="admin-domain-search"
            className="sq-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
      </div>

      {query.isLoading ? (
        <div className="sq-empty">{t("common.status.loading")}</div>
      ) : query.isError ? (
        <div className="sq-empty">{t("admin.domainCatalog.loadError")}</div>
      ) : query.data?.items.length ? (
        <div className="sq-list" style={{ marginTop: "var(--sq-space-4)" }}>
          {query.data.items.map((item) => (
            <div key={item.id} className="sq-list-item">
              <div className="sq-list-title">
                {item.certification} · {item.domain}
                {item.subdomain ? ` · ${item.subdomain}` : ""}
              </div>
              <div className="sq-list-meta">
                {item.objective_code || "-"} · {item.blueprint_code || "-"} · {item.blueprint_title || item.title || "-"}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sq-empty">{t("admin.domainCatalog.empty")}</div>
      )}
    </Card>
  );
}
