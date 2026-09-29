/** Exams, questions and the public question/domain catalog. */
import type { OptionItem } from "./common";
import type { PbqPayload, QuestionFormat } from "./pbq";

export interface Exam {
  id: string;
  title: string;
  source?: string | null;
  question_count?: number | null;
}

/** QuestionOut */
export interface QuestionItem {
  id: string;
  exam_id: string;
  prompt: string;
  multi_select: boolean;
  domain: string | null;
  difficulty: string | null;
  certification: string | null;
  tags: string[] | null;
  /** Empty for PBQs. */
  options: OptionItem[];
  /** Absent on older backends: treat as "mcq". */
  format?: QuestionFormat | (string & {});
  /** Present when format === "pbq". */
  pbq?: PbqPayload | null;
}

export interface DomainCatalogEntry {
  value: string;
  label: string;
  question_count: number;
  certifications: string[];
}

export interface DomainCatalogResponse {
  exam_id: string | null;
  domains: DomainCatalogEntry[];
}

export interface QuestionSearchItem {
  id: string;
  exam_id: string;
  exam_title?: string | null;
  prompt_excerpt: string;
  domain?: string | null;
  certification?: string | null;
  tags: string[];
  keywords: string[];
  is_bookmarked: boolean;
  has_note: boolean;
}

export interface QuestionSearchResponse {
  items: QuestionSearchItem[];
  total: number;
  limit: number;
  offset: number;
  applied_filters: Record<string, unknown>;
}
