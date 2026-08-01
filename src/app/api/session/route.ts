import { NextResponse } from "next/server";
import { z } from "zod";
import {
  logServerError,
  publicErrorDiagnostic,
  recordSessionError,
} from "@/backend/logs/error-log";
import {
  analyzeLectureMaterial,
  createNoMaterialAnalysis,
  type LectureMaterialKind,
} from "@/backend/presentation/analyze-material";
import {
  createPreparingSession,
  makeSessionReady,
  markSessionError,
} from "@/backend/session-store";
import { buildTranscriptionKeywords } from "@/backend/realtime/create-transcription-token";
import {
  BackendConfigurationError,
  backendConfigurationErrorMessage,
  getEnv,
} from "@/backend/env";

export const runtime = "nodejs";

const CreateSessionSchema = z.object({
  material: z.instanceof(File).nullable(),
  instruction: z.string().trim().min(1),
  language: z.string().trim().min(1),
});

function getMaterialKind(file: File): LectureMaterialKind | null {
  const filename = file.name.toLocaleLowerCase();
  if (file.type === "application/pdf" || filename.endsWith(".pdf")) {
    return "pdf";
  }
  if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    filename.endsWith(".pptx")
  ) {
    return "pptx";
  }
  return null;
}

// Creates the in-memory session after extracting a structured slide map.
export async function POST(request: Request) {
  let session: ReturnType<typeof createPreparingSession> | undefined;
  let requestInputValidated = false;
  try {
    const formData = await request.formData();
    const material = [formData.get("material"), formData.get("pdf")].find(
      (entry): entry is File => entry instanceof File && entry.name.length > 0,
    ) ?? null;
    const input = CreateSessionSchema.parse({
      material,
      instruction: formData.get("instruction"),
      language: formData.get("language"),
    });
    requestInputValidated = true;
    if (input.material?.size === 0) {
      const log = logServerError(
        "api.session.material_validation",
        new Error("Lecture material file is empty"),
        { filename: input.material.name, mimeType: input.material.type },
      );
      return NextResponse.json(
        {
          error: "material file must not be empty",
          diagnostic: publicErrorDiagnostic(log),
        },
        { status: 400 },
      );
    }
    const materialKind = input.material ? getMaterialKind(input.material) : null;
    if (input.material && !materialKind) {
      const log = logServerError(
        "api.session.material_validation",
        new Error("Unsupported lecture material type"),
        { filename: input.material.name, mimeType: input.material.type },
      );
      return NextResponse.json(
        {
          error: "material must be a PDF or PPTX file",
          diagnostic: publicErrorDiagnostic(log),
        },
        { status: 400 },
      );
    }

    // Every lecture eventually needs OpenAI (Realtime, notes, or questions),
    // so fail before creating session state when local configuration is absent.
    getEnv();

    session = createPreparingSession(input.instruction, input.language);
    const analysis = input.material && materialKind
      ? await analyzeLectureMaterial(
          Buffer.from(await input.material.arrayBuffer()),
          input.material.name,
          materialKind,
          input.language,
        )
      : createNoMaterialAnalysis(input.language);
    makeSessionReady(session, analysis.slideMap, analysis.materialKnowledge);

    const keywords = buildTranscriptionKeywords(analysis.slideMap);

    return NextResponse.json({
      sessionId: session.id,
      slideMap: analysis.slideMap,
      materialKnowledge: analysis.materialKnowledge,
      transcriptionHints: {
        prompt: `${analysis.materialKnowledge.title || analysis.slideMap.documentTitle}\n${analysis.materialKnowledge.summary || analysis.slideMap.documentSummary}`,
        keywords,
      },
    });
  } catch (error) {
    if (session) markSessionError(session);
    const isRequestValidation =
      !requestInputValidated && error instanceof z.ZodError;
    const isConfiguration = error instanceof BackendConfigurationError;
    const log = session
      ? recordSessionError(session, "api.session.create", error)
      : logServerError("api.session.create", error);
    return NextResponse.json(
      {
        error: isRequestValidation
          ? "Invalid session input"
          : isConfiguration
            ? backendConfigurationErrorMessage(error)
            : "Material analysis failed",
        ...(isConfiguration
          ? { code: "SERVER_CONFIGURATION_ERROR" }
          : {}),
        ...(session ? { sessionId: session.id } : {}),
        diagnostic: publicErrorDiagnostic(log),
      },
      { status: isRequestValidation ? 400 : isConfiguration ? 503 : 502 },
    );
  }
}
