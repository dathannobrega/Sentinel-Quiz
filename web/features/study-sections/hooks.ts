"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { persistSessionId } from "@/lib/auth/storage";
import { queryKeys } from "@/lib/query/keys";
import type { StudySectionDetail, StudySessionRequest, StudySessionResponse, WeakSection } from "@/types/api";

/** GET /api/materials/sections/{id}: one normalized book section for the reader (login required). */
export function useStudySectionQuery(sectionId: string) {
  return useQuery({
    queryKey: queryKeys.studySection(sectionId),
    queryFn: ({ signal }) => apiClient.get<StudySectionDetail>(`/materials/sections/${encodeURIComponent(sectionId)}`, { signal }),
    enabled: Boolean(sectionId),
    staleTime: 10 * 60_000
  });
}

/** GET /api/study/weak-sections: book sections behind the owner's mistakes, most urgent first. */
export function useWeakSectionsQuery(limit = 6) {
  return useQuery({
    queryKey: queryKeys.weakSections(limit),
    queryFn: ({ signal }) => apiClient.get<WeakSection[]>(`/study/weak-sections?limit=${limit}`, { signal })
  });
}

const PRACTICE_SIZE = 10;

/** "Practice this section": a study session with only the questions explained by that section. */
export function usePracticeSectionMutation() {
  const router = useRouter();
  return useMutation({
    mutationFn: (input: { sectionId: string; available: number }) => {
      const payload: StudySessionRequest = {
        exam_id: null,
        total_questions: Math.max(1, Math.min(PRACTICE_SIZE, input.available || PRACTICE_SIZE)),
        strategy: "standard",
        section_id: input.sectionId
      };
      return apiClient.post<StudySessionResponse>("/study/sessions", payload);
    },
    onSuccess: (session) => {
      persistSessionId("study", session.id);
      startTransition(() => {
        router.push(`/study/${encodeURIComponent(session.id)}`);
      });
    }
  });
}
