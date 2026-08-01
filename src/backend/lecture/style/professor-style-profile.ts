import { zodTextFormat } from "openai/helpers/zod";
import { recordSessionError } from "../../logs/error-log";
import { appendRawLog } from "../../logs/raw-log";
import { getEnv } from "../../env";
import { getOpenAIClient } from "../../openai-client";
import {
  ProfessorStyleDraftSchema,
  ProfessorStyleProfileSchema,
  type LectureSession,
  type ProfessorStyleDraft,
  type Transcript,
} from "../../schemas";
import { touchSession } from "../../session-store";

const INITIAL_MEANINGFUL_TURNS = 12;
const UPDATE_MEANINGFUL_TURNS = 25;
const STYLE_WINDOW_TURNS = 60;

export type ProfessorStyleGenerator = (
  turns: Transcript[],
  previous: LectureSession["professorStyleProfile"],
) => Promise<ProfessorStyleDraft>;

export function queueProfessorStyleUpdate(
  session: LectureSession,
  generator: ProfessorStyleGenerator = generateProfessorStyle,
): boolean {
  const meaningful = session.transcripts.filter(isMeaningfulStyleTurn);
  const required = session.professorStyleProfile
    ? UPDATE_MEANINGFUL_TURNS
    : INITIAL_MEANINGFUL_TURNS;
  const sinceQueued = meaningful.filter(
    (turn) => turn.sequence > session.professorStyleQueuedThroughSequence,
  );
  if (
    (!session.professorStyleProfile && meaningful.length < required) ||
    (session.professorStyleProfile && sinceQueued.length < required)
  ) {
    return false;
  }
  const turns = meaningful.slice(-STYLE_WINDOW_TURNS).map((turn) => structuredClone(turn));
  const throughSequence = meaningful.at(-1)?.sequence ?? 0;
  const previous = session.professorStyleProfile
    ? structuredClone(session.professorStyleProfile)
    : null;
  const epoch = session.professorStyleEpoch;
  session.professorStyleQueuedThroughSequence = throughSequence;

  session.professorStyleChain = session.professorStyleChain
    .catch(() => undefined)
    .then(async () => {
      const startedAt = Date.now();
      try {
        const draft = ProfessorStyleDraftSchema.parse(await generator(turns, previous));
        if (session.professorStyleEpoch !== epoch) return;
        const revision = (session.professorStyleProfile?.revision ?? 0) + 1;
        session.professorStyleProfile = ProfessorStyleProfileSchema.parse({
          ...sanitizeStyleDraft(draft),
          revision,
          updatedAt: new Date().toISOString(),
          sourceItemIds: turns.map((turn) => turn.itemId),
        });
        session.professorStyleLastProcessedSequence = throughSequence;
        touchSession(session);
        appendRawLog(
          session,
          "system",
          revision === 1 ? "professor_style_created" : "professor_style_updated",
          {
            sessionId: session.id,
            lectureRevision: session.lectureRevision,
            sourceItemIds: turns.map((turn) => turn.itemId),
            durationMs: Date.now() - startedAt,
            reason: revision === 1 ? "initial_style_profile" : "periodic_style_refresh",
          },
        );
      } catch (error) {
        if (session.professorStyleEpoch !== epoch) return;
        if (session.professorStyleQueuedThroughSequence === throughSequence) {
          session.professorStyleQueuedThroughSequence =
            session.professorStyleLastProcessedSequence;
        }
        recordSessionError(session, "professor_style_generation", error, {
          throughSequence,
          turnCount: turns.length,
        });
      }
    });
  return true;
}

export async function generateProfessorStyle(
  turns: Transcript[],
  previous: LectureSession["professorStyleProfile"],
): Promise<ProfessorStyleDraft> {
  const response = await getOpenAIClient().responses.parse({
    model: getEnv().OPENAI_FAST_MODEL,
    input: [
      {
        role: "system",
        content: `교수자의 사실 지식이 아니라 설명 방식만 프로필로 추출한다. 설명 밀도, 문장 길이, 단계 구조, 비유와 예시, 수사 질문, 전환과 강조 방식만 본다. 특정 주제의 용어, 사실 주장, 개인정보, 욕설·공격적 표현은 저장하거나 모방하지 않는다. 말버릇 복제보다 학생에게 유용한 설명 구조를 우선한다.`,
      },
      {
        role: "user",
        content: JSON.stringify({ previous, transcripts: turns.map((turn) => ({
          itemId: turn.itemId,
          text: turn.text,
        })) }),
      },
    ],
    text: {
      format: zodTextFormat(ProfessorStyleDraftSchema, "professor_style"),
    },
  });
  if (!response.output_parsed) throw new Error("PROFESSOR_STYLE_EMPTY_OUTPUT");
  return ProfessorStyleDraftSchema.parse(response.output_parsed);
}

function sanitizeStyleDraft(draft: ProfessorStyleDraft): ProfessorStyleDraft {
  const sanitizePatterns = (values: string[]) => values
    .map((value) => value.trim())
    .filter((value) => value.length >= 2 && value.length <= 60)
    .filter((value) => !UNSAFE_STYLE_PATTERN.test(value))
    .slice(0, 8);
  return {
    ...draft,
    recurringPhrases: sanitizePatterns(draft.recurringPhrases),
    emphasisPatterns: sanitizePatterns(draft.emphasisPatterns),
    transitionPatterns: sanitizePatterns(draft.transitionPatterns),
    styleSummary: draft.styleSummary.slice(0, 500),
  };
}

function isMeaningfulStyleTurn(turn: Transcript): boolean {
  const text = turn.text.trim();
  if (text.length < 12) return false;
  return !/(출석|마이크|화면|잠시\s*쉬|휴식|안녕|기기|소리.*들리)/u.test(text);
}

const UNSAFE_STYLE_PATTERN = /(씨발|병신|멍청|죽어|혐오|개새)/iu;
