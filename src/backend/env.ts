import { z } from "zod";

// Environment validation fails early at the server boundary, never in the browser.
const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  LINER_API_KEY: z.string().min(1),
  OPENAI_FAST_MODEL: z.string().min(1),
  OPENAI_SMART_MODEL: z.string().min(1),
});

export type BackendEnv = z.infer<typeof EnvSchema>;

let cachedEnv: BackendEnv | undefined;

export function getEnv(): BackendEnv {
  cachedEnv ??= EnvSchema.parse(process.env);
  return cachedEnv;
}
