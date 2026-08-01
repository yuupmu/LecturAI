import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { z } from "zod";

// End-to-end probe uses the real API pipeline with PDF/PPTX or no material.
const baseUrl = (process.env.DEMO_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

const CreateResponseSchema = z.object({
  sessionId: z.string().uuid(),
  slideMap: z.object({
    slides: z.array(z.object({ page: z.number().int().positive() }).passthrough()),
  }).passthrough(),
});
const TokenResponseSchema = z.object({
  value: z.string().min(1),
  expires_at: z.number(),
  session: z.record(z.string(), z.unknown()),
}).passthrough();
const TranscriptResponseSchema = z.object({
  action: z.enum([
    "none",
    "mark_emphasis",
    "verify_claim_with_web_search",
    "finish_lesson",
  ]),
  duplicate: z.boolean(),
  version: z.number().int(),
});
const EmphasisEventSchema = z.object({
  id: z.string(),
  type: z.literal("emphasis"),
  quote: z.string(),
  resolvedConcept: z.string(),
  confidence: z.number(),
  sourceSequences: z.array(z.number().int()),
}).passthrough();
const VerificationEventSchema = z.object({
  id: z.string(),
  type: z.literal("verification"),
  status: z.enum(["searching", "complete", "failed"]),
  verdict: z.enum([
    "supports_slide",
    "supports_lecture",
    "mixed",
    "insufficient",
  ]).nullable(),
  explanation: z.string(),
  sources: z.array(z.object({
    title: z.string().min(1),
    url: z.string().url(),
    hostname: z.string().optional(),
    description: z.string(),
  })),
}).passthrough();
const StateResponseSchema = z.object({
  status: z.enum(["preparing", "ready", "listening", "ended", "error"]),
  currentSlidePage: z.number().int().positive().nullable(),
  slideMap: z.object({
    slides: z.array(z.object({ page: z.number().int().positive() }).passthrough()),
  }).passthrough(),
  slideResolution: z.object({
    page: z.number().int().positive(),
    confidence: z.number().min(0).max(1),
    changed: z.boolean(),
    method: z.enum(["lexical", "llm_fallback", "kept_current"]),
    reason: z.string(),
  }).nullable(),
  transcripts: z.array(z.object({
    sequence: z.number().int(),
    matchedSlidePage: z.number().int().positive().nullable().optional(),
    slideConfidence: z.number().min(0).max(1).optional(),
  }).passthrough()),
  liveNotes: z.array(z.object({
    slidePage: z.number().int().positive().nullable(),
    bullets: z.array(z.object({
      id: z.string(),
      text: z.string(),
      kind: z.enum([
        "concept",
        "definition",
        "process",
        "example",
        "comparison",
        "caution",
        "formula",
      ]),
      emphasized: z.boolean(),
      sourceSequences: z.array(z.number().int()),
    })),
  }).passthrough()),
  events: z.array(z.discriminatedUnion("type", [
    EmphasisEventSchema,
    VerificationEventSchema,
  ])),
  review: z.object({ questions: z.array(z.unknown()).length(3) }).nullable(),
});
const RawResponseSchema = z.object({
  logs: z.array(z.object({
    category: z.string(),
    name: z.string(),
    payload: z.unknown(),
  }).passthrough()),
  nextCursor: z.number().int().nonnegative(),
});

type TranscriptAction = z.infer<typeof TranscriptResponseSchema>["action"];
type SessionState = z.infer<typeof StateResponseSchema>;

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function makeDemoPdf(): Buffer {
  const pageOne = [
    "BT /F1 20 Tf 72 740 Td (Binary Search Prerequisite) Tj",
    "0 -34 Td /F1 12 Tf (Binary search finds a value in a sorted array.) Tj",
    "0 -22 Td (The array must be sorted before binary search.) Tj ET",
  ].join("\n");
  const pageTwo = [
    "BT /F1 20 Tf 72 740 Td (Binary Search Time Complexity) Tj",
    "0 -34 Td /F1 12 Tf (The search range is halved at every step.) Tj",
    "0 -22 Td (Worst-case time complexity is O\\(log n\\).) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(pageOne)} >>\nstream\n${pageOne}\nendstream`,
    `<< /Length ${Buffer.byteLength(pageTwo)} >>\nstream\n${pageTwo}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n`;
  document += "0000000000 65535 f \n";
  document += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  document += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document);
}

async function main(): Promise<void> {
  const noMaterial = process.env.DEMO_NO_MATERIAL === "true";
  const materialPath = process.env.DEMO_MATERIAL_PATH ?? process.env.DEMO_PDF_PATH;
  const form = new FormData();
  if (!noMaterial) {
    const material = materialPath ? await readFile(materialPath) : makeDemoPdf();
    const filename = materialPath ? basename(materialPath) : "binary-search.pdf";
    const extension = extname(filename).toLocaleLowerCase();
    const mimeType = extension === ".pptx"
      ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      : extension === ".pdf"
        ? "application/pdf"
        : null;
    if (!mimeType) {
      throw new Error("DEMO_MATERIAL_PATH must point to a .pdf or .pptx file");
    }
    form.set(
      "material",
      new Blob([new Uint8Array(material)], { type: mimeType }),
      filename,
    );
  }
  form.set("instruction", "강의 문맥의 강조, 자료 충돌, 수업 종료를 감지하세요.");
  form.set("language", "ko");

  const created = CreateResponseSchema.parse(
    await requestJson(`${baseUrl}/api/session`, { method: "POST", body: form }),
  );
  console.log(`phase-one session created: ${created.sessionId}`);
  if (!noMaterial && !materialPath && created.slideMap.slides.length !== 2) {
    throw new Error("Generated PDF should produce exactly two slide-map pages");
  }
  console.log(`1. session created: ${created.sessionId}`);

  TokenResponseSchema.parse(
    await requestJson(`${baseUrl}/api/realtime/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: created.sessionId }),
    }),
  );
  console.log("2. live transcription client secret created");

  let sequence = 0;
  let lastItemId = "";
  const send = async (text: string): Promise<TranscriptAction> => {
    sequence += 1;
    lastItemId = randomUUID();
    const result = TranscriptResponseSchema.parse(
      await requestJson(`${baseUrl}/api/session/${created.sessionId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: lastItemId,
          sequence,
          text,
          source: "typed",
          receivedAt: new Date().toISOString(),
        }),
      }),
    );
    console.log(`   transcript ${sequence}: ${result.action}`);
    return result.action;
  };
  const readState = async (): Promise<SessionState> => StateResponseSchema.parse(
    await requestJson(`${baseUrl}/api/session/${created.sessionId}/state`),
  );

  const firstText = "이진 탐색은 정렬된 배열에서 원하는 값을 찾는 알고리즘입니다.";
  await send(firstText);
  const duplicate = TranscriptResponseSchema.parse(
    await requestJson(`${baseUrl}/api/session/${created.sessionId}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: lastItemId,
        sequence,
        text: firstText,
        source: "typed",
        receivedAt: new Date().toISOString(),
      }),
    }),
  );
  if (!duplicate.duplicate || duplicate.action !== "none") {
    throw new Error("Completed transcript duplicate was not ignored");
  }
  await send("정렬된 배열이라는 전제 아래 가운데 값을 비교해 탐색합니다.");
  if (!noMaterial) {
    await send("이제 이진 탐색의 시간복잡도를 살펴보겠습니다. 탐색 범위를 매번 절반씩 줄입니다.");
    await send("전화번호부의 가운데부터 찾고 뒤쪽 이름이면 앞 절반을 버리는 방식입니다.");
  }
  await send("이진 탐색은 정렬된 배열에서 사용하고, 탐색 범위를 매번 절반씩 줄입니다.");
  const emphasisSequence = sequence + 1;
  const emphasisAction = await send(
    "방금 말한 두 가지는 시험에 꼭 나오니 반드시 기억하세요.",
  );
  if (emphasisAction !== "mark_emphasis") {
    throw new Error(`Expected contextual emphasis action, received ${emphasisAction}`);
  }

  const emphasizedState = await readState();
  const contextualEvent = emphasizedState.events.find(
    (event) => event.type === "emphasis" &&
      event.sourceSequences.includes(emphasisSequence),
  );
  const contextualEmphasis = EmphasisEventSchema.safeParse(contextualEvent);
  if (
    !contextualEmphasis.success ||
    contextualEmphasis.data.confidence < 0.78 ||
    contextualEmphasis.data.resolvedConcept.length < 20 ||
    !contextualEmphasis.data.resolvedConcept.includes("정렬") ||
    !/(절반|반으로)/u.test(contextualEmphasis.data.resolvedConcept) ||
    /o\s*\(?log/iu.test(contextualEmphasis.data.resolvedConcept)
  ) {
    throw new Error("Contextual emphasis was not resolved into a standalone concept");
  }
  const emphasisCount = emphasizedState.events.filter(
    (event) => event.type === "emphasis",
  ).length;
  const negativeAction = await send("이 내용은 중요하지 않고 시험에도 나오지 않습니다.");
  const afterNegative = await readState();
  if (
    negativeAction !== "none" ||
    afterNegative.events.filter((event) => event.type === "emphasis").length !== emphasisCount
  ) {
    throw new Error("Negated emphasis incorrectly created an event");
  }

  if (!noMaterial) {
    const verificationAction = await send(
      "이진 탐색의 최악 시간복잡도는 O(n)입니다.",
    );
    if (verificationAction !== "verify_claim_with_web_search") {
      throw new Error(`Expected verification action, received ${verificationAction}`);
    }
  }
  const finishAction = await send("오늘 수업은 여기까지 하겠습니다.");
  if (finishAction !== "finish_lesson") {
    throw new Error(`Expected finish action, received ${finishAction}`);
  }

  const state = await readState();
  const verification = state.events.find(
    (event) => event.type === "verification",
  );
  const hasVerification = verification !== undefined;
  if (!noMaterial) {
    if (!verification || verification.type !== "verification") {
      throw new Error("OpenAI web-search verification event was not created");
    }
    if (verification.status !== "complete") {
      throw new Error(
        `OpenAI web-search verification failed: ${verification.explanation}`,
      );
    }
    if (!verification.verdict || verification.sources.length === 0) {
      throw new Error("Completed verification must contain a verdict and real citation");
    }
  }
  const allTranscriptsResolved = state.transcripts.every(
    (transcript) => transcript.matchedSlidePage !== null &&
      transcript.matchedSlidePage !== undefined &&
      transcript.slideConfidence !== undefined,
  );
  const hasEmphasizedBullet = state.liveNotes.some((note) =>
    note.bullets.some((bullet) => bullet.emphasized),
  );
  const uniqueBullets = state.liveNotes.every((note) => {
    const normalized = note.bullets.map((bullet) =>
      bullet.text.toLocaleLowerCase().replace(/\s+/g, " ").trim(),
    );
    return new Set(normalized).size === normalized.length;
  });
  const switchedToSecondSlide = noMaterial || (
    state.currentSlidePage === 2 &&
    state.transcripts.some((transcript) => transcript.matchedSlidePage === 2)
  );
  const hasPageTwoExample = noMaterial || state.liveNotes.some(
    (note) => note.slidePage === 2 &&
      note.bullets.some((bullet) => bullet.kind === "example"),
  );
  if (
    !allTranscriptsResolved ||
    !switchedToSecondSlide ||
    state.liveNotes.length === 0 ||
    !uniqueBullets ||
    !hasEmphasizedBullet ||
    !hasPageTwoExample ||
    (!noMaterial && !hasVerification) ||
    state.review?.questions.length !== 3
  ) {
    throw new Error(
      `State assertion failed: ${JSON.stringify({
        currentSlidePage: state.currentSlidePage,
        allTranscriptsResolved,
        liveNoteCount: state.liveNotes.length,
        uniqueBullets,
        hasEmphasizedBullet,
        hasPageTwoExample,
        hasVerification,
        reviewQuestions: state.review?.questions.length ?? 0,
      })}`,
    );
  }
  console.log("3. slide resolution, live-note, emphasis, verification, and review assertions passed");

  const raw = RawResponseSchema.parse(
    await requestJson(`${baseUrl}/api/session/${created.sessionId}/raw?after=0`),
  );
  const hasMarkCall = raw.logs.some(
    (log) => log.category === "tool_call" && log.name === "mark_emphasis",
  );
  const hasMarkResult = raw.logs.some(
    (log) => log.category === "tool_result" && log.name === "mark_emphasis",
  );
  if (!hasMarkCall || !hasMarkResult) {
    throw new Error("Raw log assertion failed: expected mark_emphasis call and result");
  }
  if (!noMaterial) {
    const hasSearchToolCall = raw.logs.some(
      (log) => log.category === "tool_call" &&
        log.name === "verify_claim_with_web_search",
    );
    const hasSearchToolResult = raw.logs.some(
      (log) => log.category === "tool_result" &&
        log.name === "verify_claim_with_web_search",
    );
    const hasOpenAIWebSearchCall = raw.logs.some(
      (log) => log.category === "agent_stream" &&
        log.name === "openai_web_search_call",
    );
    if (!hasSearchToolCall || !hasSearchToolResult || !hasOpenAIWebSearchCall) {
      throw new Error(
        "Raw log assertion failed: expected web-search tool call, search call, and result",
      );
    }
  }
  console.log(`4. raw log assertions passed (${raw.logs.length} logs)`);

  const resetState = StateResponseSchema.parse(
    await requestJson(`${baseUrl}/api/session/${created.sessionId}/reset`, {
      method: "POST",
    }),
  );
  if (
    resetState.status !== "ready" ||
    resetState.currentSlidePage !== 1 ||
    resetState.slideMap.slides.length !== created.slideMap.slides.length ||
    resetState.transcripts.length !== 0 ||
    resetState.liveNotes.length !== 0 ||
    resetState.events.length !== 0 ||
    resetState.review !== null
  ) {
    throw new Error("Reset assertion failed");
  }
  console.log("5. duplicate and reset assertions passed");
  console.log("LecturAI demo smoke test passed");
}

const PhaseOneStateSchema = z.object({
  status: z.enum(["preparing", "ready", "listening", "finalizing", "ended", "error"]),
  transcripts: z.array(z.object({
    id: z.string(),
    itemId: z.string(),
    sequence: z.number().int(),
    text: z.string(),
    source: z.enum(["realtime", "manual"]),
    startedAtMs: z.number().nullable(),
    endedAtMs: z.number().nullable(),
  }).passthrough()),
  lectureMemory: z.object({
    revision: z.number().int().nonnegative(),
    currentUnit: z.object({
      status: z.enum(["open", "closing_candidate"]),
    }).passthrough().nullable(),
    completedUnits: z.array(z.object({
      id: z.string(),
      title: z.string(),
      noteId: z.string().nullable(),
    }).passthrough()),
    recentTopicSummary: z.string(),
  }),
  lectureNotes: z.array(z.object({
    id: z.string(),
    title: z.string(),
    sourceItemIds: z.array(z.string()),
    sections: z.array(z.object({
      layout: z.enum(["bullets", "steps"]),
      items: z.array(z.object({
        text: z.string(),
        importance: z.enum(["normal", "important", "exam"]),
        sourceItemIds: z.array(z.string()),
        sourcePages: z.array(z.number().int().positive()),
      })),
    })),
  })),
  noteGeneratingUnitIds: z.array(z.string()),
  noteGeneration: z.object({
    enabled: z.boolean(),
    intervalSeconds: z.number().int().positive(),
    status: z.enum(["idle", "queued", "generating", "reviewing", "completed", "failed"]),
    revision: z.number().int().nonnegative(),
    lastProcessedSequence: z.number().int().nonnegative(),
    processedItemIds: z.array(z.string()),
    nextScheduledAt: z.string().nullable(),
    currentNote: z.unknown().nullable(),
    finalNote: z.unknown().nullable(),
  }),
});

async function phaseOneMain(): Promise<void> {
  const noMaterial = process.env.DEMO_NO_MATERIAL === "true";
  const form = new FormData();
  if (!noMaterial) {
    form.set(
      "material",
      new Blob([new Uint8Array(makeDemoPdf())], { type: "application/pdf" }),
      "binary-search.pdf",
    );
  }
  form.set("instruction", "2분 체크포인트마다 기존 필기에 새 대본을 누적해 주세요.");
  form.set("language", "ko");
  const created = CreateResponseSchema.parse(
    await requestJson(`${baseUrl}/api/session`, { method: "POST", body: form }),
  );
  TokenResponseSchema.parse(
    await requestJson(`${baseUrl}/api/realtime/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: created.sessionId }),
    }),
  );

  let sequence = 0;
  let firstItemId = "";
  const send = async (text: string) => {
    sequence += 1;
    const itemId = randomUUID();
    if (sequence === 1) firstItemId = itemId;
    const result = TranscriptResponseSchema.parse(
      await requestJson(`${baseUrl}/api/session/${created.sessionId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          sequence,
          text,
          source: "manual",
          receivedAt: new Date().toISOString(),
          startedAtMs: null,
          endedAtMs: null,
        }),
      }),
    );
    if (result.action !== "none") {
      throw new Error(`Deprecated action executed: ${result.action}`);
    }
  };

  const firstText = "Binary Search는 정렬된 입력에서 사용하며, 정렬 조건은 시험에 나옵니다.";
  await send(firstText);
  const duplicate = TranscriptResponseSchema.parse(
    await requestJson(`${baseUrl}/api/session/${created.sessionId}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: firstItemId,
        sequence: 1,
        text: firstText,
        source: "manual",
        receivedAt: new Date().toISOString(),
      }),
    }),
  );
  if (!duplicate.duplicate) throw new Error("Transcript duplicate was not ignored");
  await send("첫째, 탐색 구간의 중간값을 확인합니다.");
  await send("둘째, 목표값과 중간값을 비교합니다.");
  await send("셋째, 비교 결과에 따라 필요 없는 절반을 제거합니다.");
  await send("매 단계에서 탐색 범위가 절반으로 감소합니다.");
  await send("그래서 최악 시간복잡도 O(log n)은 중요한 결론입니다.");
  await send("다음으로 해시 탐색을 보겠습니다. 해시 탐색은 해시 값을 사용합니다.");
  await send("해시 함수는 키를 저장 위치에 대응시킵니다.");

  let state: z.infer<typeof PhaseOneStateSchema> | null = null;
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    state = PhaseOneStateSchema.parse(
      await requestJson(`${baseUrl}/api/session/${created.sessionId}/state`),
    );
    if (
      state.transcripts.length === sequence &&
      state.noteGeneration.status === "completed" &&
      state.noteGeneration.lastProcessedSequence === sequence &&
      state.lectureNotes.length === 1
    ) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!state || state.lectureNotes.length === 0) {
    const raw = RawResponseSchema.parse(
      await requestJson(`${baseUrl}/api/session/${created.sessionId}/raw?after=0`),
    );
    throw new Error(
      `Structured note was not published before the smoke-test deadline for ${created.sessionId}: ${JSON.stringify({
        revision: state?.noteGeneration.revision ?? null,
        noteStatus: state?.noteGeneration.status ?? null,
        lastProcessedSequence: state?.noteGeneration.lastProcessedSequence ?? null,
        rawLogNames: raw.logs.map((log) => log.name),
      })}`,
    );
  }
  const note = state.lectureNotes[0];
  const items = note.sections.flatMap((section) => section.items);
  const text = items.map((item) => item.text).join(" ");
  const steps = note.sections.find((section) => section.layout === "steps")?.items ?? [];
  const grounded = items.every((item) =>
    item.sourceItemIds.length > 0 || item.sourcePages.length > 0
  );
  const importantCondition = items.some((item) =>
    /정렬/u.test(item.text) && item.importance !== "normal"
  );
  const importantComplexity = items.some((item) =>
    /O\s*\(log\s*n\)/iu.test(item.text) && item.importance !== "normal"
  );
  if (
    !/Binary Search|이진 탐색/iu.test(note.title) ||
    !/정렬/u.test(text) ||
    !/중간값/u.test(text) ||
    !/목표값/u.test(text) ||
    !/절반/u.test(text) ||
    !/O\s*\(log\s*n\)/iu.test(text) ||
    steps.length < 3 ||
    !grounded ||
    !importantCondition ||
    !importantComplexity
  ) throw new Error(`Binary Search note regression failed: ${JSON.stringify(note)}`);

  const raw = RawResponseSchema.parse(
    await requestJson(`${baseUrl}/api/session/${created.sessionId}/raw?after=0`),
  );
  const requiredLogs = [
    "transcript_saved",
    "note_schedule_started",
    "note_generation_started",
    "note_generation_context_built",
    "note_review_started",
    "note_review_completed",
    "note_generation_completed",
  ];
  if (!requiredLogs.every((name) => raw.logs.some((log) => log.name === name))) {
    throw new Error("New lecture pipeline raw logs are incomplete");
  }
  if (raw.logs.some((log) => /web_search/iu.test(log.name))) {
    throw new Error("Web search executed during phase-one smoke test");
  }

  const reset = PhaseOneStateSchema.parse(
    await requestJson(`${baseUrl}/api/session/${created.sessionId}/reset`, { method: "POST" }),
  );
  if (
    reset.status !== "ready" || reset.transcripts.length !== 0 ||
    reset.lectureNotes.length !== 0 ||
    reset.noteGeneration.revision !== 0 ||
    reset.noteGeneration.currentNote !== null ||
    reset.noteGeneration.finalNote !== null ||
    reset.noteGeneration.nextScheduledAt !== null
  ) throw new Error("Cumulative note reset assertion failed");
  console.log("LecturAI cumulative-note smoke test passed");
}

// Keep the deprecated smoke workflow typechecked while the phase-one entrypoint
// verifies that it is no longer used.
void main;
phaseOneMain().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
