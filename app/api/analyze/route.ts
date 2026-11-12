import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { WORKOUT_TYPES, type AnalyzeRequest, type AnalyzeResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const num = z.number().nullable();

const ResultSchema = z.object({
  date: z.string().nullable().describe("운동 날짜 YYYY-MM-DD. 캡처에서 알 수 없으면 null"),
  start_time: z.string().nullable().describe("시작 시각 HH:MM (24시간제). 모르면 null"),
  metrics: z.object({
    duration_min: num.describe("운동 시간(분). 1:05:30 → 65.5"),
    active_kcal: num.describe("활동 칼로리(kcal)"),
    total_kcal: num.describe("총 칼로리(kcal)"),
    avg_hr: num.describe("평균 심박수(bpm)"),
    max_hr: num.describe("최대 심박수(bpm). 심박 그래프의 최고치"),
    min_hr: num.describe("최저 심박수(bpm). 심박 그래프의 최저치"),
    distance_m: num.describe("수영 거리(m). 헬스는 null"),
    laps: num.describe("수영 랩 수"),
    pool_length_m: num.describe("수영장 길이(m)"),
    avg_pace_sec_per_100m: num.describe("평균 페이스, 100m당 초. 2'30\"/100m → 150"),
    hr_zones: z
      .object({
        zone1_min: num,
        zone2_min: num,
        zone3_min: num,
        zone4_min: num,
        zone5_min: num,
      })
      .nullable()
      .describe("심박수 영역별 머문 시간(분). 영역 화면이 없으면 null"),
  }),
  analysis: z.object({
    summary: z.string().describe("오늘 운동을 2~3문장으로 요약"),
    intensity: z.enum(["easy", "moderate", "hard", "very_hard"]),
    highlights: z.array(z.string()).describe("눈에 띄는 점 2~4개 (수치 근거 포함)"),
    suggestions: z.array(z.string()).describe("다음 운동을 위한 구체적 제안 1~3개"),
    comparison: z
      .string()
      .describe("최근 같은 종류 운동과 비교. 비교할 기록이 없으면 빈 문자열"),
    unreadable: z.array(z.string()).describe("캡처에서 읽지 못했거나 확신이 낮은 항목"),
  }),
});

const SYSTEM = `너는 애플워치 운동 기록을 읽고 분석해 주는 운동 코치야.
사용자는 수영(강습/자유수영)과 헬스(PT 수업/개인운동)를 한다.

할 일:
1. 첨부된 애플워치/아이폰 피트니스 앱 캡처에서 수치를 정확히 읽어 metrics에 넣는다.
   - 여러 장이면 모두 합쳐서 하나의 운동으로 본다.
   - 화면에 없는 값은 추측하지 말고 null. 단위 변환(시간→분, km→m, 페이스→초)은 해도 된다.
   - 한국어/영어 UI 모두 나올 수 있다 (예: 활동 킬로칼로리 = Active Kilocalories, 평균 심박수 = Avg. Heart Rate).
   - 캡처가 없고 직접 입력된 수치만 있으면 그 값을 그대로 metrics로 돌려준다.
2. analysis는 친근한 한국어 존댓말로, 수치를 근거로 짧고 구체적으로 쓴다.
   - 심박 영역 분포, 평균/최대 심박, 시간 대비 칼로리, (수영) 거리·페이스를 해석한다.
   - 강습/PT는 코치가 강도를 정하므로 "꾸준함"과 회복 관점, 자유수영/개인운동은 스스로 조절한 강도 관점으로 본다.
   - 최근 기록이 주어지면 comparison에 변화(늘었다/줄었다)를 숫자로 적는다.
   - 의학적 진단은 하지 않는다.`;

export async function POST(req: Request) {
  const passcode = process.env.APP_PASSCODE;
  if (passcode && req.headers.get("x-app-passcode") !== passcode) {
    return Response.json({ error: "암호가 맞지 않아요. 설정에서 앱 암호를 확인해 주세요." }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았어요. .env.local을 확인해 주세요." },
      { status: 500 },
    );
  }

  let body: AnalyzeRequest;
  try {
    body = (await req.json()) as AnalyzeRequest;
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }
  const typeLabel = WORKOUT_TYPES.find((w) => w.id === body.type)?.label;
  if (!typeLabel) return Response.json({ error: "운동 종류를 골라 주세요." }, { status: 400 });
  const images = (body.images ?? []).slice(0, 6);
  if (images.length === 0 && !body.metrics) {
    return Response.json({ error: "캡처 이미지나 수치를 넣어 주세요." }, { status: 400 });
  }

  const content: Anthropic.Beta.BetaContentBlockParam[] = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.media_type, data: img.data },
  }));
  content.push({
    type: "text",
    text: [
      `오늘 날짜: ${body.today}`,
      `운동 종류: ${typeLabel}`,
      body.memo?.trim() ? `사용자 메모:\n${body.memo.trim()}` : "사용자 메모: 없음",
      body.metrics ? `직접 입력한 수치(JSON):\n${JSON.stringify(body.metrics)}` : "",
      body.recent?.length
        ? `최근 같은 종류 운동 기록(JSON, 최신순):\n${JSON.stringify(body.recent)}`
        : "최근 같은 종류 운동 기록: 없음",
      images.length ? `캡처 ${images.length}장을 읽고 분석해 주세요.` : "입력된 수치로 분석해 주세요.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(ResultSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return Response.json({ error: "이 이미지는 분석할 수 없었어요. 다른 캡처로 시도해 주세요." }, { status: 422 });
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      return Response.json({ error: "분석 결과를 읽지 못했어요. 다시 시도해 주세요." }, { status: 502 });
    }
    const result: AnalyzeResponse = response.parsed_output;
    return Response.json(result);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "API 키가 올바르지 않아요." }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "요청이 많아요. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }
    if (error instanceof Anthropic.BadRequestError) {
      return Response.json({ error: `요청 오류: ${error.message}` }, { status: 400 });
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: `Claude API 오류 (${error.status})` }, { status: 502 });
    }
    console.error(error);
    return Response.json({ error: "분석 중 알 수 없는 오류가 났어요." }, { status: 500 });
  }
}
