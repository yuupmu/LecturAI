import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../env";
import { getOpenAIClient } from "../openai-client";
import { SlideMapSchema, type SlideMap } from "../schemas";

export type LectureMaterialKind = "pdf" | "pptx";

const MATERIAL_MIME_TYPES: Record<LectureMaterialKind, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// Extracts a compact, slide-addressable fact map from PDF or PPTX input.
export async function analyzeLectureMaterial(
  material: Buffer,
  filename: string,
  kind: LectureMaterialKind,
  language: string,
): Promise<SlideMap> {
  const mimeType = MATERIAL_MIME_TYPES[kind];
  const fileData = `data:${mimeType};base64,${material.toString("base64")}`;
  const unitName = kind === "pdf" ? "PDF page" : "presentation slide";
  const prompt = [
    `Create a slide map in the requested language: ${language}.`,
    `Create one slides[] entry for every ${unitName}, preserving the 1-based page number.`,
    "Extract only facts directly visible in the document. Never infer or guess.",
    "Each factualClaim must be atomic and independently verifiable.",
    "Return at most six factualClaims per slide.",
    "Include Korean and English aliases in keywords when the document supports them.",
    "Prioritize formulas, definitions, prerequisites, and time complexity.",
    "Use stable, unique claim ids such as p2-c1.",
  ].join("\n");

  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_SMART_MODEL,
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
    text: { format: zodTextFormat(SlideMapSchema, "slide_map") },
  });

  if (!response.output_parsed) {
    throw new Error("MATERIAL_ANALYSIS_EMPTY_OUTPUT");
  }
  return SlideMapSchema.parse(response.output_parsed);
}

// A virtual page keeps emphasis and review page references valid without slides.
export function createNoMaterialSlideMap(language: string): SlideMap {
  const korean = language.toLocaleLowerCase().startsWith("ko");
  return SlideMapSchema.parse({
    documentTitle: korean ? "자료 없는 실시간 강의" : "Live lecture without slides",
    documentSummary: korean
      ? "슬라이드 근거 없이 실시간 발화의 명시적 강조와 수업 종료를 모니터링합니다."
      : "Monitors explicit emphasis and lesson completion from live speech without slide evidence.",
    language,
    globalKeywords: [],
    slides: [
      {
        page: 1,
        title: korean ? "실시간 강의" : "Live lecture",
        summary: korean
          ? "이 페이지는 자료가 없는 강의의 발화 문맥을 위한 가상 페이지입니다."
          : "This virtual page represents lecture context when no material is supplied.",
        keyConcepts: [],
        factualClaims: [],
        keywords: [],
      },
    ],
  });
}
