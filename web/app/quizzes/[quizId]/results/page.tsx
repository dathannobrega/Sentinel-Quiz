import { redirect } from "next/navigation";

/** /quizzes/{id}/results (J6) lists the sessions; each session links to its report. */
export default async function Page({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  redirect(`/quizzes/${encodeURIComponent(decodeURIComponent(quizId))}/sessions`);
}
