"use client";

import { useMemo, useState } from "react";
import { WORKOUT_TYPES, typeInfo, type Category, type Workout } from "@/lib/types";
import { fmtDuration, fmtNum, todayStr } from "@/lib/format";
import { Legend, LineChart, StackedBars } from "./charts";
import { WorkoutRow } from "./WorkoutList";
import { allExerciseNames, exerciseHistory, summarizeSets, topWeight, volume } from "@/lib/exercise";

// 카테고리 색 슬롯은 운동 종류에 고정 (필터해도 색이 바뀌지 않음)
const SERIES = WORKOUT_TYPES.map((t, i) => ({ key: t.id, label: t.short, color: `var(--series-${i + 1})` }));

function weekStart(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // 월요일 시작
  x.setDate(x.getDate() - day);
  return x;
}

function parse(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default function Dashboard({
  workouts,
  onOpen,
  onAdd,
}: {
  workouts: Workout[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const [filter, setFilter] = useState<"all" | Category>("all");
  const list = useMemo(
    () => workouts.filter((w) => filter === "all" || typeInfo(w.type).category === filter),
    [workouts, filter],
  );
  const series = SERIES.filter((s) => filter === "all" || typeInfo(s.key).category === filter);

  const month = todayStr().slice(0, 7);
  const thisMonth = list.filter((w) => w.date.startsWith(month));
  const sum = (arr: Workout[], f: (w: Workout) => number | null) => arr.reduce((s, w) => s + (f(w) ?? 0), 0);
  const swimDist = sum(thisMonth, (w) => w.metrics.distance_m);

  // 최근 8주
  const weeks = useMemo(() => {
    const start = weekStart(new Date());
    return Array.from({ length: 8 }, (_, k) => {
      const ws = new Date(start);
      ws.setDate(ws.getDate() - 7 * (7 - k));
      const we = new Date(ws);
      we.setDate(we.getDate() + 7);
      const values: Record<string, number> = {};
      for (const w of list) {
        const d = parse(w.date);
        if (d >= ws && d < we) values[w.type] = (values[w.type] ?? 0) + (w.metrics.duration_min ?? 0);
      }
      return {
        label: `${ws.getMonth() + 1}/${ws.getDate()}`,
        sub: `${ws.getMonth() + 1}/${ws.getDate()} 주`,
        values,
      };
    });
  }, [list]);

  // 최근 20회 심박수
  const hr = useMemo(
    () =>
      list
        .filter((w) => w.metrics.avg_hr != null || w.metrics.max_hr != null)
        .slice(0, 20)
        .reverse()
        .map((w) => {
          const [, m, d] = w.date.split("-").map(Number);
          return {
            axis: `${m}/${d}`,
            label: `${m}/${d} ${typeInfo(w.type).short}`,
            values: { avg: w.metrics.avg_hr, max: w.metrics.max_hr },
          };
        }),
    [list],
  );

  if (workouts.length === 0) {
    return (
      <div className="card mt-6 space-y-3 p-6 text-center">
        <div className="text-4xl">🏊‍♀️🏋️</div>
        <h1 className="text-lg font-bold">첫 운동을 기록해 볼까요?</h1>
        <p className="muted text-sm leading-relaxed">
          애플워치 운동 기록(아이폰 피트니스 앱)을 캡처해서 넣으면
          <br />
          심박수·칼로리·거리를 읽고 분석해 드려요.
        </p>
        <button className="btn btn-primary" onClick={onAdd}>
          ➕ 새 기록 추가
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(
          [
            ["all", "전체"],
            ["swim", "🏊 수영"],
            ["gym", "🏋️ 헬스"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="muted text-sm font-semibold">이번 달</h2>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="운동 횟수" value={`${thisMonth.length}회`} />
          <Stat label="운동 시간" value={fmtDuration(sum(thisMonth, (w) => w.metrics.duration_min))} />
          <Stat label="활동 칼로리" value={fmtNum(sum(thisMonth, (w) => w.metrics.active_kcal), " kcal")} />
          {filter !== "gym" ? (
            <Stat label="수영 거리" value={swimDist >= 1000 ? `${(swimDist / 1000).toFixed(1)} km` : `${fmtNum(swimDist)} m`} />
          ) : (
            <Stat
              label="PT / 개인운동"
              value={`${thisMonth.filter((w) => w.type === "gym_pt").length} / ${thisMonth.filter((w) => w.type === "gym_solo").length}회`}
            />
          )}
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold">주별 운동 시간 (분)</h2>
          <Legend items={series} />
        </div>
        <StackedBars data={weeks} series={series} unit="분" />
      </section>

      {hr.length > 0 && (
        <section className="card space-y-3 p-4">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold">운동별 심박수 (최근 {hr.length}회, bpm)</h2>
            <Legend
              items={[
                { label: "평균 심박", color: "var(--series-1)" },
                { label: "최대 심박", color: "var(--series-2)" },
              ]}
            />
          </div>
          <LineChart
            data={hr}
            unit="bpm"
            series={[
              { key: "avg", label: "평균 심박", color: "var(--series-1)" },
              { key: "max", label: "최대 심박", color: "var(--series-2)" },
            ]}
          />
        </section>
      )}

      {filter !== "swim" && <ExerciseProgress workouts={workouts} />}

      <section className="space-y-2">
        <h2 className="muted text-sm font-semibold">최근 기록</h2>
        {list.slice(0, 3).map((w) => (
          <WorkoutRow key={w.id} w={w} onOpen={onOpen} />
        ))}
        {list.length === 0 && <p className="faint text-sm">이 종류의 기록이 아직 없어요.</p>}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="muted text-xs">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function ExerciseProgress({ workouts }: { workouts: Workout[] }) {
  const names = useMemo(() => allExerciseNames(workouts), [workouts]);
  const [picked, setPicked] = useState<string | null>(null);
  const name = picked && names.includes(picked) ? picked : names[0];
  if (!name) return null;

  const hist = exerciseHistory(workouts, name).slice(0, 20).reverse();
  const points = hist
    .map(({ workout, exercise }) => {
      const [, m, d] = workout.date.split("-").map(Number);
      return {
        axis: `${m}/${d}`,
        label: `${m}/${d} ${typeInfo(workout.type).short} · ${summarizeSets(exercise.sets)}`,
        values: { top: topWeight(exercise) },
      };
    })
    .filter((p) => p.values.top != null);
  const latest = hist[hist.length - 1];
  const best = Math.max(...hist.map((h) => topWeight(h.exercise) ?? 0));

  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold">종목별 성장</h2>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {names.map((n) => (
          <button key={n} className="chip shrink-0 text-xs" aria-pressed={n === name} onClick={() => setPicked(n)}>
            {n}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <MiniStat label="기록 횟수" value={`${hist.length}회`} />
        <MiniStat label="최고 무게" value={best > 0 ? `${best}kg` : "맨몸"} />
        <MiniStat
          label="최근 볼륨"
          value={latest ? `${Math.round(volume(latest.exercise)).toLocaleString("ko-KR")}kg` : "–"}
        />
      </div>
      {points.length >= 2 ? (
        <>
          <p className="muted text-xs">회차별 최고 무게 (kg)</p>
          <LineChart data={points} unit="kg" series={[{ key: "top", label: "최고 무게", color: "var(--series-1)" }]} />
        </>
      ) : (
        <p className="faint text-xs">
          {latest ? `최근: ${summarizeSets(latest.exercise.sets)} · ` : ""}두 번 이상 기록하면 그래프가 나와요.
        </p>
      )}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-2" style={{ background: "var(--surface-2)" }}>
      <div className="faint text-[11px]">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
