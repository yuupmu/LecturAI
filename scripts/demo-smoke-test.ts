import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { z } from "zod";

// End-to-end probe accepts PDF/PPTX and can also exercise the no-material flow.
const baseUrl = (process.env.DEMO_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

const CreateResponseSchema = z.object({ sessionId: z.string().uuid() });
const TranscriptResponseSchema = z.object({
  action: z.enum([
    "none",
    "mark_emphasis",
    "verify_claim_with_liner",
    "finish_lesson",
  ]),
  duplicate: z.boolean(),
  version: z.number().int(),
});
const StateResponseSchema = z.object({
  events: z.array(z.object({ type: z.string() }).passthrough()),
  review: z
    .object({ questions: z.array(z.unknown()).length(3) })
    .nullable(),
});
const RawResponseSchema = z.object({
  logs: z.array(z.object({ category: z.string() }).passthrough()),
  nextCursor: z.number().int().nonnegative(),
});

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function makeDemoPdf(): Buffer {
  const text = [
    "BT /F1 20 Tf 72 740 Td (Binary Search) Tj",
    "0 -32 Td /F1 12 Tf (Prerequisite: the array must be sorted.) Tj",
    "0 -22 Td (Worst-case time complexity is O\\(log n\\).) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
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
  const materialPath =
    process.env.DEMO_MATERIAL_PATH ?? process.env.DEMO_PDF_PATH;
  const form = new FormData();
  if (!noMaterial) {
    const material = materialPath
      ? await readFile(materialPath)
      : makeDemoPdf();
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
  form.set("instruction", "강의에서 명시적 강조, 자료 충돌, 수업 종료만 감지하세요.");
  form.set("language", "ko");

  const created = CreateResponseSchema.parse(
    await requestJson(`${baseUrl}/api/session`, { method: "POST", body: form }),
  );
  console.log(`1. session created: ${created.sessionId}`);

  const texts = [
    "오늘은 이진 탐색 알고리즘을 배웁니다.",
    "정렬된 배열이라는 전제는 시험에 꼭 나옵니다.",
    "이진 탐색의 최악 시간복잡도는 O(n)입니다.",
    "오늘 수업은 여기까지 하겠습니다.",
  ];

  for (let index = 0; index < texts.length; index += 1) {
    const result = TranscriptResponseSchema.parse(
      await requestJson(
        `${baseUrl}/api/session/${created.sessionId}/transcript`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: randomUUID(),
            sequence: index + 1,
            text: texts[index],
            source: "typed",
            receivedAt: new Date().toISOString(),
          }),
        },
      ),
    );
    console.log(`${index + 2}. transcript action: ${result.action}`);
  }

  const state = StateResponseSchema.parse(
    await requestJson(`${baseUrl}/api/session/${created.sessionId}/state`),
  );
  const hasEmphasis = state.events.some((event) => event.type === "emphasis");
  const hasVerification = state.events.some(
    (event) => event.type === "verification",
  );
  if (
    !hasEmphasis ||
    (!noMaterial && !hasVerification) ||
    state.review?.questions.length !== 3
  ) {
    throw new Error(
      noMaterial
        ? "State assertion failed: expected emphasis and 3 review questions"
        : "State assertion failed: expected emphasis, verification, and 3 review questions",
    );
  }
  console.log("6. state assertions passed");

  const raw = RawResponseSchema.parse(
    await requestJson(`${baseUrl}/api/session/${created.sessionId}/raw?after=0`),
  );
  const hasToolCall = raw.logs.some((log) => log.category === "tool_call");
  const hasToolResult = raw.logs.some((log) => log.category === "tool_result");
  if (!hasToolCall || !hasToolResult) {
    throw new Error("Raw log assertion failed: expected tool_call and tool_result");
  }
  console.log(`7. raw log assertions passed (${raw.logs.length} logs)`);
  console.log("LecturAI demo smoke test passed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
