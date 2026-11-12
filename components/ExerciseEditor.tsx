"use client";

import { useState } from "react";
import type { Exercise, ExerciseSet, Workout } from "@/lib/types";
import { uid } from "@/lib/format";
import {
  COMMON_EXERCISES,
  allExerciseNames,
  exerciseHistory,
  summarizeSets,
  volume,
} from "@/lib/exercise";

export default function ExerciseEditor({
  value,
  onChange,
  workouts,
  currentId,
  lastSameType,
}: {
  value: Exercise[];
  onChange: (v: Exercise[]) => void;
  workouts: Workout[];
  currentId?: string;
  /** 같은 종류의 직전 헬스 기록 (종목 불러오기용) */
  lastSameType?: Workout;
}) {
  const names = [...new Set([...allExerciseNames(workouts), ...COMMON_EXERCISES])];
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const update = (id: string, fn: (e: Exercise) => Exercise) =>
    onChange(value.map((e) => (e.id === id ? fn(e) : e)));

  function addExercise() {
    const id = uid();
    onChange([...value, { id, name: "", sets: [{ weight_kg: null, reps: null }] }]);
    setJustAdded(id);
  }

  function loadLast() {
    if (!lastSameType?.exercises?.length) return;
    onChange([
      ...value,
      ...lastSameType.exercises.map((e) => ({ id: uid(), name: e.name, sets: e.sets.map((s) => ({ ...s })) })),
    ]);
  }

  const total = value.reduce((s, e) => s + volume(e), 0);
  const totalSets = value.reduce((s, e) => s + e.sets.filter((x) => x.reps != null || x.weight_kg != null).length, 0);

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">종목 · 세트</h2>
          <p className="faint mt-1 text-xs">
            {value.length ? `${value.length}종목 · ${totalSets}세트 · 총 볼륨 ${Math.round(total).toLocaleString("ko-KR")}kg` : "오늘 한 종목을 추가해 주세요."}
          </p>
        </div>
        {lastSameType?.exercises?.length ? (
          <button className="chip shrink-0 text-xs" onClick={loadLast}>
            ↺ 지난번 종목 불러오기
          </button>
        ) : null}
      </div>

      <datalist id="exercise-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {value.map((ex, i) => (
        <ExerciseCard
          key={ex.id}
          index={i}
          ex={ex}
          autoFocus={ex.id === justAdded}
          last={ex.name.trim() ? exerciseHistory(workouts, ex.name, currentId)[0]?.exercise : undefined}
          onChange={(fn) => update(ex.id, fn)}
          onRemove={() => onChange(value.filter((e) => e.id !== ex.id))}
          onMove={(dir) => {
            const j = i + dir;
            if (j < 0 || j >= value.length) return;
            const next = [...value];
            [next[i], next[j]] = [next[j], next[i]];
            onChange(next);
          }}
        />
      ))}

      <button className="btn w-full border-dashed" onClick={addExercise}>
        ＋ 종목 추가
      </button>
    </section>
  );
}

function ExerciseCard({
  index,
  ex,
  last,
  autoFocus,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  ex: Exercise;
  last?: Exercise;
  autoFocus: boolean;
  onChange: (fn: (e: Exercise) => Exercise) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const setSet = (i: number, patch: Partial<ExerciseSet>) =>
    onChange((e) => ({ ...e, sets: e.sets.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: "var(--surface-2)" }}>
      <div className="flex items-center gap-2">
        <span className="faint w-5 text-center text-sm font-semibold">{index + 1}</span>
        <input
          className="input flex-1 font-semibold"
          list="exercise-names"
          placeholder="종목 이름 (예: 스쿼트)"
          value={ex.name}
          autoFocus={autoFocus}
          onChange={(e) => onChange((x) => ({ ...x, name: e.target.value }))}
        />
        <div className="flex shrink-0">
          <IconBtn label="위로" onClick={() => onMove(-1)}>
            ↑
          </IconBtn>
          <IconBtn label="아래로" onClick={() => onMove(1)}>
            ↓
          </IconBtn>
          <IconBtn
            label="종목 삭제"
            onClick={() => {
              if (!ex.name && ex.sets.every((s) => s.weight_kg == null && s.reps == null)) onRemove();
              else if (confirm(`'${ex.name || "이 종목"}'을(를) 지울까요?`)) onRemove();
            }}
          >
            ✕
          </IconBtn>
        </div>
      </div>

      {last && (
        <p className="faint pl-7 text-xs">
          지난번: {summarizeSets(last.sets)}
        </p>
      )}

      <div className="space-y-1.5 pl-7">
        <div className="faint grid grid-cols-[2.5rem_1fr_1fr_2rem] gap-2 text-[11px]">
          <span>세트</span>
          <span>무게 (kg)</span>
          <span>횟수</span>
          <span />
        </div>
        {ex.sets.map((s, i) => (
          <div key={i} className="grid grid-cols-[2.5rem_1fr_1fr_2rem] items-center gap-2">
            <span className="muted text-sm tabular-nums">{i + 1}</span>
            <NumInput value={s.weight_kg} placeholder="맨몸" onChange={(v) => setSet(i, { weight_kg: v })} />
            <NumInput value={s.reps} placeholder="회" onChange={(v) => setSet(i, { reps: v })} integer />
            <IconBtn
              label={`${i + 1}세트 삭제`}
              onClick={() => onChange((e) => ({ ...e, sets: e.sets.filter((_, j) => j !== i) }))}
            >
              −
            </IconBtn>
          </div>
        ))}
        <button
          className="chip w-full text-sm"
          style={{ borderRadius: 10 }}
          onClick={() =>
            onChange((e) => ({
              ...e,
              sets: [...e.sets, { ...(e.sets[e.sets.length - 1] ?? { weight_kg: null, reps: null }) }],
            }))
          }
        >
          ＋ 세트 추가 (직전 세트 복사)
        </button>
      </div>
    </div>
  );
}

function NumInput({
  value,
  onChange,
  placeholder,
  integer,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  integer?: boolean;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [prev, setPrev] = useState(value);
  // 부모 값이 바뀌면(세트 복사 등) 표시도 맞춰 줌
  if (prev !== value) {
    setPrev(value);
    if (Number(text) !== value) setText(value == null ? "" : String(value));
  }
  return (
    <input
      className="input text-center tabular-nums"
      inputMode={integer ? "numeric" : "decimal"}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const s = e.target.value.replace(",", ".");
        if (s !== "" && !/^\d*\.?\d*$/.test(s)) return;
        setText(s);
        const v = s === "" || s === "." ? null : Number(s);
        setPrev(v);
        onChange(v);
      }}
    />
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="muted flex h-8 w-8 items-center justify-center rounded-lg text-sm"
    >
      {children}
    </button>
  );
}
