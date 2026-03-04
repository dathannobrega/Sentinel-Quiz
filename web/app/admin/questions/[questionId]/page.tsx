import { AdminShell } from "@/features/admin/components/admin-shell";

export default async function AdminQuestionEditorPage({
  params
}: {
  params: Promise<{ questionId: string }>;
}) {
  const { questionId } = await params;
  return <AdminShell editorOnly initialQuestionId={decodeURIComponent(questionId)} />;
}
