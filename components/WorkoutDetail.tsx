"use client";

import { typeInfo, type Workout } from "@/lib/types";
import { fmtDate, fmtDuration, fmtNum, fmtPace } from "@/lib/format";
import AnalysisCard from "./AnalysisCard";
import { ZoneBars } from "./charts";
import { exerciseHistory, summarizeSets, topWeight, totalReps, volume } from "@/lib/exercise";

export default function WorkoutDetail({
  workout: w,
  workouts,
  onBack,
  onEdit,
  onDelete,
}: {
  workout: Workout;
  workouts: Workout[];
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = typeInfo(w.type);
  const m = w.metrics;
  const isSwim = t.category === "swim";

  // 같은 종류 직전 기록 대비 변화
  // (workouts는 최신순 정렬이므로, 이 기록 뒤쪽에서 처음 나오는 같은 종류가 직전 기록)
  const idx = workouts.findIndex((x) => x.id === w.id);
  const prev = workouts.slice(idx + 1).find((x) => x.type === w.type);

  const tiles: { label: string; value: string; delta?: string }[] = [
    { label: "운동 시간", value: fmtDuration(m.duration_min), delta: diff(m.duration_min, prev?.metrics.duration_min, "분") },
    { label: "활동 칼로리", value: fmtNum(m.active_kcal, " kcal"), delta: diff(m.active_kcal, prev?.metrics.active_kcal, " kcal") },
    { label: "평균 심박", value: fmtNum(m.avg_hr, " bpm"), delta: diff(m.avg_hr, prev?.metrics.avg_hr, " bpm") },
    { label: "최대 심박", value: fmtNum(m.max_hr, " bpm") },
  ];
  if (m.total_kcal != null) tiles.push({ label: "총 칼로리", value: fmtNum(m.total_kcal, " kcal") });
  if (m.min_hr != null) tiles.push({ label: "최저 심박", value: fmtNum(m.min_hr, " bpm") });
  if (isSwim) {
    tiles.push({ label: "거리", value: fmtNum(m.distance_m, " m"), delta: diff(m.distance_m, prev?.metrics.distance_m, " m") });
    tiles.push({ label: "평균 페이스", value: fmtPace(m.avg_pace_sec_per_100m) });
    if (m.laps != null) tiles.push({ label: "랩", value: `${fmtNum(m.laps)}랩${m.pool_length_m ? ` (${m.pool_length_m}m 풀)` : ""}` });
  }

  return (
    <div className="space-y-4">
      <button className="muted text-sm" onClick={onBack}>
        ‹ 목록
      </button>
      <div className="flex items-center gap-3">
        <span className="text-4xl" aria-hidden>
          {t.emoji}
        </span>
        <div>
          <h1 className="text-xl font-bold">{t.label}</h1>
          <p className="muted text-sm">
            {fmtDate(w.date)}
            {w.startTime ? ` · ${w.startTime} 시작` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {tiles.map((x) => (
          <div key={x.label} className="card p-3">
            <div className="muted text-xs">{x.label}</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums">{x.value}</div>
            {x.delta && <div className="faint text-xs">지난번보다 {x.delta}</div>}
          </div>
        ))}
      </div>

      {!isSwim && !!w.exercises?.length && (
        <section className="card space-y-3 p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">종목 · 세트</h2>
            <span className="faint text-xs">
              {w.exercises.length}종목 · {w.exercises.reduce((s, e) => s + e.sets.length, 0)}세트 · 총 볼륨{" "}
              {Math.round(w.exercises.reduce((s, e) => s + volume(e), 0)).toLocaleString("ko-KR")}kg
            </span>
          </div>
          <ul className="space-y-2.5">
            {w.exercises.map((e) => {
              const prevEx = exerciseHistory(workouts.slice(idx + 1), e.name)[0]?.exercise;
              const tw = topWeight(e);
              const pw = prevEx ? topWeight(prevEx) : null;
              const v = volume(e);
              return (
                <li key={e.id} className="space-y-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{e.name}</span>
                    <span className="faint shrink-0 text-xs tabular-nums">
                      {v > 0 ? `볼륨 ${Math.round(v).toLocaleString("ko-KR")}kg` : `${totalReps(e)}회`}
                    </span>
                  </div>
                  <div className="muted text-sm">{summarizeSets(e.sets)}</div>
                  {prevEx && (
                    <div className="faint text-xs">
                      지난번 {summarizeSets(prevEx.sets)}
                      {tw != null && pw != null && tw !== pw && (
                        <span> · 최고 무게 {tw > pw ? "▲" : "▼"} {Math.abs(Math.round((tw - pw) * 10) / 10)}kg</span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {m.hr_zones && (
        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold">심박수 영역</h2>
          <ZoneBars zones={m.hr_zones} />
        </section>
      )}

      {w.analysis ? (
        <AnalysisCard analysis={w.analysis} />
      ) : (
        <p className="faint text-sm">아직 AI 분석이 없어요. 수정 화면에서 캡처를 넣고 분석해 보세요.</p>
      )}

      {w.memo && (
        <section className="card space-y-1 p-4">
          <h2 className="text-sm font-semibold">메모</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{w.memo}</p>
        </section>
      )}

      <div className="flex gap-2 pt-2">
        <button className="btn flex-1" onClick={onEdit}>
          수정 · 다시 분석
        </button>
        <button className="btn" style={{ color: "var(--danger)" }} onClick={onDelete}>
          삭제
        </button>
      </div>
    </div>
  );
}

function diff(cur: number | null, prev: number | null | undefined, unit: string) {
  if (cur == null || prev == null) return undefined;
  const d = Math.round(cur - prev);
  if (d === 0) return "같음";
  return `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toLocaleString("ko-KR")}${unit}`;
}
