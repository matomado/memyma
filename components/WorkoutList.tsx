"use client";

import { useState } from "react";
import { INTENSITY_LABEL, typeInfo, type Category, type Workout } from "@/lib/types";
import { fmtDate, fmtDuration, fmtNum } from "@/lib/format";

export function WorkoutRow({ w, onOpen }: { w: Workout; onOpen: (id: string) => void }) {
  const t = typeInfo(w.type);
  const m = w.metrics;
  return (
    <button onClick={() => onOpen(w.id)} className="card flex w-full items-center gap-3 p-3 text-left">
      <span className="text-2xl" aria-hidden>
        {t.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="font-semibold">{t.short}</span>
          <span className="faint text-xs">
            {fmtDate(w.date)}
            {w.startTime ? ` ${w.startTime}` : ""}
          </span>
        </span>
        <span className="muted mt-0.5 block truncate text-sm">
          {[
            fmtDuration(m.duration_min),
            m.active_kcal != null && `${fmtNum(m.active_kcal)} kcal`,
            m.avg_hr != null && `평균 ${fmtNum(m.avg_hr)} bpm`,
            m.distance_m != null && `${fmtNum(m.distance_m)} m`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {w.analysis && (
        <span className="chip shrink-0 text-xs" style={{ padding: "2px 8px" }}>
          {INTENSITY_LABEL[w.analysis.intensity]}
        </span>
      )}
    </button>
  );
}

export default function WorkoutList({
  workouts,
  onOpen,
}: {
  workouts: Workout[];
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | Category>("all");
  const list = workouts.filter((w) => filter === "all" || typeInfo(w.type).category === filter);

  // 월별로 묶기
  const groups = new Map<string, Workout[]>();
  for (const w of list) {
    const key = w.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), w]);
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

      {list.length === 0 && <p className="faint py-10 text-center">아직 기록이 없어요.</p>}

      {[...groups.entries()].map(([month, items]) => {
        const [y, mo] = month.split("-");
        return (
          <section key={month} className="space-y-2">
            <h2 className="muted text-sm font-semibold">
              {y}년 {Number(mo)}월 · {items.length}회
            </h2>
            {items.map((w) => (
              <WorkoutRow key={w.id} w={w} onOpen={onOpen} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
