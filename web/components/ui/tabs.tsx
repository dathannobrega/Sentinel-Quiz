"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

interface TabItem {
  id: string;
  label: string;
  badge?: ReactNode;
  content: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  defaultValue?: string;
  ariaLabel: string;
  className?: string;
}

export function Tabs({ items, defaultValue, ariaLabel, className }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultValue || items[0]?.id || "");

  useEffect(() => {
    if (!items.length) {
      setActiveTab("");
      return;
    }
    if (!items.some((item) => item.id === activeTab)) {
      setActiveTab(defaultValue || items[0].id);
    }
  }, [activeTab, defaultValue, items]);

  return (
    <div className={cn("sq-tabs", className)}>
      <div className="sq-tabs__list" role="tablist" aria-label={ariaLabel}>
        {items.map((item) => {
          const isActive = item.id === activeTab;
          return (
            <button
              key={item.id}
              id={`tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${item.id}`}
              className={cn("sq-tabs__trigger", isActive && "sq-tabs__trigger--active")}
              onClick={() => setActiveTab(item.id)}
            >
              <span>{item.label}</span>
              {item.badge ? <span className="sq-chip">{item.badge}</span> : null}
            </button>
          );
        })}
      </div>

      {items.map((item) => {
        const isActive = item.id === activeTab;
        return (
          <div
            key={item.id}
            id={`panel-${item.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${item.id}`}
            hidden={!isActive}
            className="sq-tabs__panel"
          >
            {isActive ? item.content : null}
          </div>
        );
      })}
    </div>
  );
}
