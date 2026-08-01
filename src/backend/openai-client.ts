import OpenAI from "openai";
import { getEnv } from "./env";

// A lazy singleton keeps all calls in the one intended Node.js process.
let client: OpenAI | undefined;

export function getOpenAIClient(): OpenAI {
  client ??= new OpenAI({
    apiKey: getEnv().OPENAI_API_KEY,
    // Interactive jobs are queued in memory. A stalled request must fail and
    // release the queue instead of making every later button look unresponsive.
    timeout: 60_000,
    maxRetries: 0,
  });
  return client;
}
