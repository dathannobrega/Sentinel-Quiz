"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import { apiClient, readErrorMessage } from "@/lib/api/client";
import type { QuestionIssueMode, QuestionIssueRequest } from "@/types/api";

const MIN_MESSAGE_LENGTH = 8;

interface IssueReportPanelProps {
  sessionId: string;
  questionId: string;
  mode: QuestionIssueMode;
  t: Translate;
}

/** Mount with `key={questionId}` so the draft resets per question. */
export function IssueReportPanel({ sessionId, questionId, mode, t }: IssueReportPanelProps) {
  const [category, setCategory] = useState<QuestionIssueRequest["category"]>("clareza");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function submit() {
    if (message.trim().length < MIN_MESSAGE_LENGTH) {
      return;
    }
    setIsSubmitting(true);
    setNotice(null);
    try {
      const payload: QuestionIssueRequest = {
        session_id: sessionId,
        mode,
        category,
        message: message.trim()
      };
      await apiClient.post(`/questions/${encodeURIComponent(questionId)}/issues`, payload);
      setMessage("");
      setNotice({ tone: "success", text: t("runner.issueReport.success") });
    } catch (error) {
      setNotice({ tone: "error", text: readErrorMessage(error, t("runner.errors.actionFailed")) });
    } finally {
      setIsSubmitting(false);
    }
  }

  const fieldPrefix = `${mode}-issue`;

  return (
    <div className="sq-runner-utility">
      <div className="sq-runner-utility__head">
        <div>
          <div className="sq-list-title">{t("runner.issueReport.title")}</div>
          <div className="sq-list-meta">{t("runner.issueReport.subtitle")}</div>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="sq-gap-top-sm">
          <Field label={t("runner.issueReport.category")} htmlFor={`${fieldPrefix}-category`}>
            <select
              id={`${fieldPrefix}-category`}
              className="sq-select"
              value={category}
              onChange={(event) => setCategory(event.target.value as QuestionIssueRequest["category"])}
            >
              <option value="clareza">{t("runner.issueReport.clarity")}</option>
              <option value="gabarito">{t("runner.issueReport.answerKey")}</option>
              <option value="explicacao">{t("runner.issueReport.explanation")}</option>
              <option value="referencia">{t("runner.issueReport.reference")}</option>
            </select>
          </Field>
        </div>
        <div className="sq-gap-top-sm">
          <Field
            label={t("runner.issueReport.detail")}
            htmlFor={`${fieldPrefix}-message`}
            hint={t("runner.issueReport.detailHint")}
            hintMode="inline"
          >
            <textarea
              id={`${fieldPrefix}-message`}
              className="sq-textarea"
              rows={4}
              minLength={MIN_MESSAGE_LENGTH}
              maxLength={2000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </Field>
        </div>
        <div className="sq-actions sq-gap-top-sm">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            busy={isSubmitting}
            disabled={message.trim().length < MIN_MESSAGE_LENGTH}
          >
            {t("runner.issueReport.send")}
          </Button>
        </div>
      </form>
      {notice ? (
        <div className="sq-list-meta sq-gap-top-sm" role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}
