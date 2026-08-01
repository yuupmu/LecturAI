import { z } from "zod";

const PositiveSecondsSchema = z.coerce.number().int().min(1).max(86_400);

export function getExplicitEndingGraceSeconds(): number {
  return PositiveSecondsSchema.default(10).parse(
    process.env.LECTURE_ENDING_GRACE_SECONDS,
  );
}

export function getInactivitySeconds(): number {
  return PositiveSecondsSchema.default(600).parse(
    process.env.LECTURE_INACTIVITY_SECONDS,
  );
}

export function getInactivityGraceSeconds(): number {
  return PositiveSecondsSchema.default(30).parse(
    process.env.LECTURE_INACTIVITY_GRACE_SECONDS,
  );
}

// Environment validation fails early at the server boundary, never in the browser.
const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_FAST_MODEL: z.string().min(1),
  OPENAI_SMART_MODEL: z.string().min(1),
  OPENAI_FINAL_NOTE_MODEL: z.preprocess(
    (value) => typeof value === "string" && value.trim() === ""
      ? undefined
      : value,
    z.string().trim().min(1).default("gpt-4.1-nano"),
  ),
  OPENAI_MATERIAL_MODEL: z.preprocess(
    (value) => typeof value === "string" && value.trim() === ""
      ? undefined
      : value,
    z.string().trim().min(1).optional(),
  ),
  OPENAI_SEARCH_MODEL: z.preprocess(
    (value) => typeof value === "string" && value.trim() === ""
      ? undefined
      : value,
    z.string().trim().min(1).optional(),
  ),
  OPENAI_TRANSLATION_MODEL: z.preprocess(
    (value) => typeof value === "string" && value.trim() === ""
      ? undefined
      : value,
    z.string().trim().min(1).default("gpt-4.1-nano"),
  ),
  LECTURE_ENDING_GRACE_SECONDS: PositiveSecondsSchema.default(10),
  LECTURE_INACTIVITY_SECONDS: PositiveSecondsSchema.default(600),
  LECTURE_INACTIVITY_GRACE_SECONDS: PositiveSecondsSchema.default(30),
});

export type BackendEnv = z.infer<typeof EnvSchema>;

export class BackendConfigurationError extends Error {
  readonly invalidVariables: string[];

  constructor(error: z.ZodError) {
    const invalidVariables = Array.from(
      new Set(
        error.issues.flatMap((issue) =>
          typeof issue.path[0] === "string" ? [issue.path[0]] : []
        ),
      ),
    );
    super("Backend environment configuration is invalid", { cause: error });
    this.name = "BackendConfigurationError";
    this.invalidVariables = invalidVariables;
  }
}

export function backendConfigurationErrorMessage(
  error: BackendConfigurationError,
): string {
  const variables = error.invalidVariables.length > 0
    ? error.invalidVariables.join(", ")
    : "환경 변수";
  return `.env.local의 ${variables} 설정을 확인하고 개발 서버를 다시 시작해 주세요.`;
}

let cachedEnv: BackendEnv | undefined;

export function getEnv(): BackendEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new BackendConfigurationError(parsed.error);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}
