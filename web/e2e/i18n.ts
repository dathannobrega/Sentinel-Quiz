import { createTranslator, getMessages } from "@/lib/i18n/core";

/** The browser runs with locale pt-BR (default app locale); assert against the same catalog. */
export const { t } = createTranslator(getMessages("pt-BR"));
