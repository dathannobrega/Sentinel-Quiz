import type { Metadata } from "next";

import { BookChapters } from "@/features/reading/components/book-chapters";
import { getServerTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslator();
  return { title: t("system.metadata.read"), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ book: string }> }) {
  const { book } = await params;
  return <BookChapters slug={decodeURIComponent(book)} />;
}
