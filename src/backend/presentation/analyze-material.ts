import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../env";
import { getOpenAIClient } from "../openai-client";
import {
  MaterialAnalysisSchema,
  MaterialKnowledgeSchema,
  SlideMapSchema,
  type MaterialAnalysis,
  type MaterialKnowledge,
  type SlideMap,
} from "../schemas";

export type LectureMaterialKind = "pdf" | "pptx";

const MATERIAL_MIME_TYPES: Record<LectureMaterialKind, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// Extracts grounded, whole-document knowledge. Slide Map is emitted only as a
// compatibility projection for the existing material UI and keyword hints.
export async function analyzeLectureMaterial(
  material: Buffer,
  filename: string,
  kind: LectureMaterialKind,
  language: string,
): Promise<MaterialAnalysis> {
  const mimeType = MATERIAL_MIME_TYPES[kind];
  const fileData = `data:${mimeType};base64,${material.toString("base64")}`;
  const unitName = kind === "pdf" ? "PDF page" : "presentation slide";
  const prompt = [
    `Analyze the complete lecture material in the requested language: ${language}.`,
    "MATERIAL_KNOWLEDGE is the primary result. It supports semantic lecture interpretation and review notes, not page scoring.",
    "Extract only content actually visible in the document. Do not add explanations, assumptions, or general knowledge.",
    "Separate definitions, required conditions, ordered processes, formulas, comparisons, examples, and warnings.",
    "Preserve a concise verbatim sourceText excerpt and its 1-based sourcePage for every extracted item and process.",
    "Do not impose a per-page item limit. Extract all review-worthy content without duplicating the same idea.",
    "For a process, keep its stated step order. Do not invent missing steps.",
    "Terminology aliases may be included only when the aliases are visible in this document.",
    "Use stable unique ids derived from page and order, such as topic-1, p2-definition-1, and p3-process-1.",
    `Also create a compatibility SLIDE_MAP with one slides[] entry for every ${unitName}, preserving 1-based page numbers.`,
    "The compatibility slide map may be compact, but it must be derived from MATERIAL_KNOWLEDGE and visible document text only.",
  ].join("\n");
  const env = getEnv();

  const response = await getOpenAIClient().responses.parse({
    model: env.OPENAI_MATERIAL_MODEL ?? env.OPENAI_SMART_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename:
              filename || (kind === "pdf" ? "lecture.pdf" : "lecture.pptx"),
            file_data: fileData,
            detail: "low",
          },
          { type: "input_text", text: prompt },
        ],
      },
    ],
    text: { format: zodTextFormat(MaterialAnalysisSchema, "material_analysis") },
  });

  if (!response.output_parsed) {
    throw new Error("MATERIAL_ANALYSIS_EMPTY_OUTPUT");
  }
  return MaterialAnalysisSchema.parse(response.output_parsed);
}

export function createEmptyMaterialKnowledge(): MaterialKnowledge {
  return MaterialKnowledgeSchema.parse({
    title: "",
    summary: "",
    outline: [],
    terminology: [],
  });
}

// The virtual page is retained only so the legacy material surface can render.
export function createNoMaterialAnalysis(language: string): MaterialAnalysis {
  const korean = language.toLocaleLowerCase().startsWith("ko");
  const slideMap = SlideMapSchema.parse({
    documentTitle: korean ? "자료 없는 실시간 강의" : "Live lecture without slides",
    documentSummary: korean
      ? "자료 없이 누적 수업 대본만으로 강의 흐름과 필기를 구성합니다."
      : "Builds lecture context and notes from the accumulated transcript without material.",
    language,
    globalKeywords: [],
    slides: [
      {
        page: 1,
        title: korean ? "실시간 강의" : "Live lecture",
        summary: korean
          ? "자료가 없는 강의를 위한 빈 자료 화면입니다."
          : "This virtual page represents lecture context when no material is supplied.",
        keyConcepts: [],
        factualClaims: [],
        keywords: [],
      },
    ],
  });
  return MaterialAnalysisSchema.parse({
    materialKnowledge: createEmptyMaterialKnowledge(),
    slideMap,
  });
}

/** @deprecated Use createNoMaterialAnalysis for new session state. */
export function createNoMaterialSlideMap(language: string): SlideMap {
  return createNoMaterialAnalysis(language).slideMap;
}
