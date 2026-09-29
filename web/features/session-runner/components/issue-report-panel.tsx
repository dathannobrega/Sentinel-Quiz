"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
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

/** Collapsed by default: reporting is a rare, secondary action. Mount with `key={questionId}`. */
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
    <Disclosure variant="plain" summary={t("runner.issueReport.title")} hint={t("runner.issueReport.subtitle")}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t("runner.issueReport.category")} htmlFor={`${fieldPrefix}-category`}>
          <Select
            id={`${fieldPrefix}-category`}
            value={category}
            onChange={(event) => setCategory(event.target.value as QuestionIssueRequest["category"])}
          >
            <option value="clareza">{t("runner.issueReport.clarity")}</option>
            <option value="gabarito">{t("runner.issueReport.answerKey")}</option>
            <option value="explicacao">{t("runner.issueReport.explanation")}</option>
            <option value="referencia">{t("runner.issueReport.reference")}</option>
          </Select>
        </Field>
        <Field label={t("runner.issueReport.detail")} htmlFor={`${fieldPrefix}-message`} hint={t("runner.issueReport.detailHint")} hintMode="inline">
          <Textarea
            id={`${fieldPrefix}-message`}
            rows={4}
            minLength={MIN_MESSAGE_LENGTH}
            maxLength={2000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </Field>
        <div>
          <Button type="submit" variant="secondary" size="sm" busy={isSubmitting} disabled={message.trim().length < MIN_MESSAGE_LENGTH}>
            {t("runner.issueReport.send")}
          </Button>
        </div>
        {notice ? (
          <p className={notice.tone === "error" ? "text-xs text-danger" : "text-xs text-success"} role={notice.tone === "error" ? "alert" : "status"}>
            {notice.text}
          </p>
        ) : null}
      </form>
    </Disclosure>
  );
}
