import OpenAI from "openai";
import { getEnv } from "./env";

// A lazy singleton keeps all calls in the one intended Node.js process.
let client: OpenAI | undefined;

export function getOpenAIClient(): OpenAI {
  client ??= new OpenAI({ apiKey: getEnv().OPENAI_API_KEY });
  return client;
}
