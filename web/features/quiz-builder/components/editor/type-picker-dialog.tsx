"use client";

import { Dialog } from "@/components/ui/dialog";
import { ItemTypeIcon } from "@/features/quiz-builder/components/icons";
import { ITEM_TYPES, SCORED_TYPES } from "@/features/quiz-builder/lib/items";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveItemType } from "@/types/api";

interface TypePickerProps {
  /** Types enabled by the server (capabilities.item_types); defaults to all seven. */
  types?: LiveItemType[];
  onPick: (type: LiveItemType) => void;
  disabled?: boolean;
}

/** Grid of the item types: icon, name, one-line description and whether it scores. */
export function TypePickerGrid({ types, onPick, disabled = false }: TypePickerProps) {
  const { t } = useI18n();
  const list = ITEM_TYPES.filter((type) => !types?.length || types.includes(type));
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {list.map((type, index) => (
        <li key={type} className="motion-safe:animate-[rise-in_220ms_var(--ease-out)_both]" style={{ animationDelay: `${index * 30}ms` }}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(type)}
            className={cn(
              "focus-ring group flex h-full w-full items-start gap-3 rounded-lg border border-line bg-surface p-3 text-left",
              "transition-[border-color,background-color,transform] duration-150 hover:border-primary hover:bg-primary-soft/40",
              "motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-muted text-fg transition-colors group-hover:bg-primary group-hover:text-on-primary">
              <ItemTypeIcon type={type} size={20} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                {t(`quizBuilder.types.${type}.name`)}
                <span className="rounded-sm bg-surface-muted px-1.5 py-px text-[0.6875rem] font-medium text-fg-muted">
                  {SCORED_TYPES.has(type) ? t("quizBuilder.typePicker.scored") : t("quizBuilder.typePicker.notScored")}
                </span>
              </span>
              <span className="text-[0.8125rem] leading-snug text-fg-muted">{t(`quizBuilder.types.${type}.description`)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TypePickerDialog({
  open,
  onClose,
  ...props
}: TypePickerProps & { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("quizBuilder.typePicker.title")}
      description={t("quizBuilder.typePicker.description")}
      className="w-[min(44rem,calc(100vw-2rem))]"
      showCloseButton
    >
      <TypePickerGrid {...props} />
    </Dialog>
  );
}
