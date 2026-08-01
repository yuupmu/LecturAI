import { z } from "zod";
import { getEnv } from "../env";
import { LinerSourceSchema } from "../schemas";

const LinerResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      hostname: z.string().optional(),
      description: z.string().optional().default(""),
      date: z.string().nullable().optional().default(null),
    }),
  ),
});

// One bounded Liner request is made with no retries, as intended for the demo.
export async function linerSearch(
  query: string,
  searchMode: "web" | "scholar",
) {
  const endpoint = `https://platform.liner.com/api/v1/tools/search/${searchMode}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": getEnv().LINER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, max_results: 3 }),
    signal: AbortSignal.timeout(5_000),
  });

  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`LINER_SEARCH_FAILED_${response.status}`);
  const parsed = LinerResponseSchema.parse(payload);

  return parsed.results.slice(0, 3).map((result) =>
    LinerSourceSchema.parse({
      ...result,
      hostname: result.hostname ?? new URL(result.url).hostname,
    }),
  );
}
