"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

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

/** WAI-ARIA tabs: roving tabindex, Arrow/Home/End navigation, automatic activation. */
export function Tabs({ items, defaultValue, ariaLabel, className }: TabsProps) {
  const baseId = useId();
  const [selectedTab, setSelectedTab] = useState(defaultValue || items[0]?.id || "");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activeTab = items.some((item) => item.id === selectedTab) ? selectedTab : defaultValue || items[0]?.id || "";

  function focusTab(index: number) {
    const item = items[(index + items.length) % items.length];
    if (!item) {
      return;
    }
    setSelectedTab(item.id);
    tabRefs.current[item.id]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(items.length - 1);
        break;
      default:
        break;
    }
  }

  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = (id: string) => `${baseId}-panel-${id}`;

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1" role="tablist" aria-label={ariaLabel}>
        {items.map((item, index) => {
          const isActive = item.id === activeTab;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[item.id] = node;
              }}
              id={tabId(item.id)}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId(item.id)}
              tabIndex={isActive ? 0 : -1}
              className={cn(
                "focus-ring relative -mb-px inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors",
                isActive ? "border-primary text-fg" : "border-transparent text-fg-muted hover:text-fg"
              )}
              onClick={() => setSelectedTab(item.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span>{item.label}</span>
              {item.badge ? (
                <span className="nums rounded-sm bg-surface-muted px-1.5 text-xs text-fg-muted">{item.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {items.map((item) => {
        const isActive = item.id === activeTab;
        return (
          <div
            key={item.id}
            id={panelId(item.id)}
            role="tabpanel"
            aria-labelledby={tabId(item.id)}
            hidden={!isActive}
            tabIndex={0}
            className="focus-ring rounded-sm"
          >
            {isActive ? item.content : null}
          </div>
        );
      })}
    </div>
  );
}
