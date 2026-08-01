import assert from "node:assert/strict";
import { POST as createSession } from "../src/app/api/session/route";
import { POST as createRealtimeToken } from "../src/app/api/realtime/token/route";
import { createNoMaterialAnalysis } from "../src/backend/presentation/analyze-material";
import {
  createPreparingSession,
  makeSessionReady,
} from "../src/backend/session-store";

const requiredOpenAiVariables = [
  "OPENAI_API_KEY",
  "OPENAI_FAST_MODEL",
  "OPENAI_SMART_MODEL",
] as const;

type JsonObject = Record<string, unknown>;

async function readJson(response: Response): Promise<JsonObject> {
  const payload: unknown = await response.json();
  assert.ok(payload && typeof payload === "object" && !Array.isArray(payload));
  return payload as JsonObject;
}

async function main(): Promise<void> {
  const previousValues = new Map(
    requiredOpenAiVariables.map((name) => [name, process.env[name]]),
  );
  for (const name of requiredOpenAiVariables) delete process.env[name];

  try {
    const invalidForm = new FormData();
    invalidForm.set("instruction", "");
    invalidForm.set("language", "ko");
    const invalidResponse = await createSession(
      new Request("http://localhost/api/session", {
        method: "POST",
        body: invalidForm,
      }),
    );
    const invalidPayload = await readJson(invalidResponse);
    assert.equal(invalidResponse.status, 400);
    assert.equal(invalidPayload.error, "Invalid session input");

    const configurationForm = new FormData();
    configurationForm.set("instruction", "강의를 정리해 주세요.");
    configurationForm.set("language", "ko");
    const configurationResponse = await createSession(
      new Request("http://localhost/api/session", {
        method: "POST",
        body: configurationForm,
      }),
    );
    const configurationPayload = await readJson(configurationResponse);
    assert.equal(configurationResponse.status, 503);
    assert.equal(configurationPayload.code, "SERVER_CONFIGURATION_ERROR");
    assert.equal(typeof configurationPayload.error, "string");
    for (const name of requiredOpenAiVariables) {
      assert.match(String(configurationPayload.error), new RegExp(name));
    }
    assert.match(String(configurationPayload.error), /개발 서버를 다시 시작/);

    const session = createPreparingSession("강의를 정리해 주세요.", "ko");
    const analysis = createNoMaterialAnalysis("ko");
    makeSessionReady(
      session,
      analysis.slideMap,
      analysis.materialKnowledge,
    );
    const tokenResponse = await createRealtimeToken(
      new Request("http://localhost/api/realtime/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      }),
    );
    const tokenPayload = await readJson(tokenResponse);
    assert.equal(tokenResponse.status, 503);
    assert.equal(tokenPayload.code, "SERVER_CONFIGURATION_ERROR");
    assert.match(String(tokenPayload.error), /\.env\.local/);
  } finally {
    for (const [name, value] of previousValues) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  console.log("Session error classification tests passed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
