import { AdminShell } from "@/features/admin/components/admin-shell";

interface AdminQuestionEditorPageProps {
  params: {
    questionId: string;
  };
}

export default function AdminQuestionEditorPage({ params }: AdminQuestionEditorPageProps) {
  return <AdminShell editorOnly initialQuestionId={decodeURIComponent(params.questionId)} />;
}
