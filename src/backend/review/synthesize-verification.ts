import { zodTextFormat } from "openai/helpers/zod";
import { getEnv } from "../env";
import { getOpenAIClient } from "../openai-client";
import {
  VerificationSynthesisSchema,
  type VerifyClaimArgsSchema,
} from "../schemas";
import type { z } from "zod";

type VerifyArgs = z.infer<typeof VerifyClaimArgsSchema>;

// A fast structured call turns raw search snippets into a neutral correction.
export async function synthesizeVerification(
  args: VerifyArgs,
  sources: unknown[],
) {
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_FAST_MODEL,
    input: [
      {
        role: "system",
        content:
          "Compare the lecture claim and slide claim using only the supplied search results. Be neutral, concise, and never say the professor is wrong. If evidence is weak, choose insufficient.",
      },
      {
        role: "user",
        content: JSON.stringify({
          lectureClaim: args.lectureClaim,
          slideClaim: args.slideClaim,
          sources,
        }),
      },
    ],
    text: {
      format: zodTextFormat(
        VerificationSynthesisSchema,
        "verification_synthesis",
      ),
    },
  });

  if (!response.output_parsed) throw new Error("VERIFICATION_SYNTHESIS_EMPTY");
  return VerificationSynthesisSchema.parse(response.output_parsed);
}
