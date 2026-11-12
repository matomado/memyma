"use client";

import { useEffect, useRef, useState } from "react";
import {
  WORKOUT_TYPES,
  emptyMetrics,
  typeInfo,
  type Analysis,
  type AnalyzeRequest,
  type Exercise,
  type AnalyzeResponse,
  type HrZones,
  type Metrics,
  type Workout,
  type WorkoutType,
} from "@/lib/types";
import { todayStr, uid } from "@/lib/format";
import { fileToJpegBase64 } from "@/lib/image";
import { getPasscode } from "@/lib/storage";
import { cleanExercises, summarizeSets } from "@/lib/exercise";
import AnalysisCard from "./AnalysisCard";
import ExerciseEditor from "./ExerciseEditor";

interface Shot {
  id: string;
  url: string;
  file: File;
}

export default function WorkoutEditor({
  initial,
  workouts,
  onSave,
  onCancel,
}: {
  initial?: Workout;
  workouts: Workout[];
  onSave: (w: Workout) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<WorkoutType>(initial?.type ?? "swim_lesson");
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [exercises, setExercises] = useState<Exercise[]>(initial?.exercises ?? []);
  const [metrics, setMetrics] = useState<Metrics>(initial?.metrics ?? emptyMetrics());
  const [analysis, setAnalysis] = useState<Analysis | null>(initial?.analysis ?? null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), [shots]);

  const isSwim = typeInfo(type).category === "swim";
  const others = workouts.filter((w) => w.id !== initial?.id);
  const lastSameType =
    others.find((w) => w.type === type && w.exercises?.length) ??
    others.find((w) => typeInfo(w.type).category === "gym" && w.exercises?.length);
  const exLines = (list: Exercise[] | undefined) =>
    cleanExercises(list ?? []).map((e) => `${e.name}: ${summarizeSets(e.sets)}`);
  const set = <K extends keyof Metrics>(k: K, v: Metrics[K]) => setMetrics((m) => ({ ...m, [k]: v }));

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next = [...files]
      .filter((f) => f.type.startsWith("image/"))
      .map((file) => ({ id: uid(), file, url: URL.createObjectURL(file) }));
    setShots((s) => [...s, ...next].slice(0, 6));
  }

  async function analyze() {
    setBusy(true);
    setError(null);
    try {
      const images = await Promise.all(
        shots.map(async (s) => ({ media_type: "image/jpeg" as const, data: await fileToJpegBase64(s.file) })),
      );
      const hasMetrics = Object.values(metrics).some((v) => v != null);
      const recent = workouts
        .filter((w) => w.type === type && w.id !== initial?.id)
        .slice(0, 5)
        .map((w) => ({
          date: w.date,
          type: w.type,
          duration_min: w.metrics.duration_min,
          active_kcal: w.metrics.active_kcal,
          avg_hr: w.metrics.avg_hr,
          max_hr: w.metrics.max_hr,
          distance_m: w.metrics.distance_m,
          exercises: isSwim ? undefined : exLines(w.exercises),
        }));
      const payload: AnalyzeRequest = {
        type,
        memo,
        images,
        metrics: images.length === 0 && hasMetrics ? metrics : undefined,
        exercises: isSwim ? undefined : exLines(exercises),
        recent,
        today: todayStr(),
      };
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-passcode": getPasscode() },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as AnalyzeResponse & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `오류 ${res.status}`);

      // 캡처에서 읽은 값으로 채우되, 못 읽은 값(null)은 기존 입력을 유지
      setMetrics((prev) => {
        const merged = { ...prev };
        for (const k of Object.keys(data.metrics) as (keyof Metrics)[]) {
          const v = data.metrics[k];
          if (v != null) (merged as Record<string, unknown>)[k] = v;
        }
        return merged;
      });
      if (data.date && !initial) setDate(data.date);
      if (data.start_time) setStartTime(data.start_time);
      setAnalysis(data.analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const now = new Date().toISOString();
    onSave({
      id: initial?.id ?? uid(),
      type,
      date,
      startTime: startTime || null,
      memo,
      metrics,
      exercises: isSwim ? undefined : cleanExercises(exercises),
      analysis,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  }

  const canAnalyze =
    shots.length > 0 ||
    Object.values(metrics).some((v) => v != null) ||
    (!isSwim && cleanExercises(exercises).length > 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{initial ? "기록 수정" : "새 운동 기록"}</h1>
        <button className="muted text-sm" onClick={onCancel}>
          취소
        </button>
      </div>

      <section className="space-y-2">
        <Label>운동 종류</Label>
        <div className="grid grid-cols-2 gap-2">
          {WORKOUT_TYPES.map((w) => (
            <button
              key={w.id}
              className="chip py-2.5 text-[15px]"
              style={{ borderRadius: 12 }}
              aria-pressed={type === w.id}
              onClick={() => setType(w.id)}
            >
              {w.emoji} {w.label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Field label="날짜">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="시작 시각">
          <input
            type="time"
            className="input"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </Field>
      </section>

      {!isSwim && (
        <ExerciseEditor
          value={exercises}
          onChange={setExercises}
          workouts={workouts}
          currentId={initial?.id}
          lastSameType={lastSameType}
        />
      )}

      <section className="card space-y-3 p-4">
        <div>
          <Label>애플워치 캡처</Label>
          <p className="faint mt-1 text-xs leading-relaxed">
            아이폰 피트니스 앱 → 운동 상세 화면을 캡처해서 넣어 주세요. 요약·심박수·심박수 영역·랩 화면을
            여러 장(최대 6장) 넣으면 더 정확해요.
          </p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {shots.map((s) => (
            <div key={s.id} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt="운동 캡처" className="h-28 w-auto rounded-lg border" />
              <button
                aria-label="캡처 빼기"
                className="absolute -top-2 -right-2 h-6 w-6 rounded-full text-xs"
                style={{ background: "var(--text)", color: "var(--surface)" }}
                onClick={() => setShots((list) => list.filter((x) => x.id !== s.id))}
              >
                ✕
              </button>
            </div>
          ))}
          {shots.length < 6 && (
            <button
              className="flex h-28 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs"
              style={{ borderColor: "var(--text-3)", color: "var(--text-2)" }}
              onClick={() => fileRef.current?.click()}
            >
              <span className="text-xl">＋</span>캡처 추가
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <Field label="메모 (선택)">
          <textarea
            className="input min-h-20"
            placeholder={
              isSwim
                ? "예: 자유형 위주, 접영 드릴 / 오늘 숨이 좀 찼음"
                : "예: 오늘 하체 날, 무릎 컨디션 좋음 / 트레이너가 자세 교정해 줌"
            }
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </Field>
        <button className="btn btn-primary w-full" disabled={!canAnalyze || busy} onClick={analyze}>
          {busy ? "분석 중… (20~40초)" : shots.length ? "✨ 캡처 읽고 분석하기" : "✨ 입력한 기록으로 분석하기"}
        </button>
        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
            {error}
          </p>
        )}
      </section>

      {analysis && <AnalysisCard analysis={analysis} />}

      <section className="card space-y-3 p-4">
        <div>
          <Label>운동 수치</Label>
          <p className="faint mt-1 text-xs">분석하면 자동으로 채워져요. 직접 고쳐도 됩니다.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="운동 시간 (분)" value={metrics.duration_min} onChange={(v) => set("duration_min", v)} />
          <NumField label="활동 칼로리 (kcal)" value={metrics.active_kcal} onChange={(v) => set("active_kcal", v)} />
          <NumField label="총 칼로리 (kcal)" value={metrics.total_kcal} onChange={(v) => set("total_kcal", v)} />
          <NumField label="평균 심박 (bpm)" value={metrics.avg_hr} onChange={(v) => set("avg_hr", v)} />
          <NumField label="최대 심박 (bpm)" value={metrics.max_hr} onChange={(v) => set("max_hr", v)} />
          <NumField label="최저 심박 (bpm)" value={metrics.min_hr} onChange={(v) => set("min_hr", v)} />
          {isSwim && (
            <>
              <NumField label="거리 (m)" value={metrics.distance_m} onChange={(v) => set("distance_m", v)} />
              <NumField label="랩 수" value={metrics.laps} onChange={(v) => set("laps", v)} />
              <NumField label="풀 길이 (m)" value={metrics.pool_length_m} onChange={(v) => set("pool_length_m", v)} />
              <PaceField value={metrics.avg_pace_sec_per_100m} onChange={(v) => set("avg_pace_sec_per_100m", v)} />
            </>
          )}
        </div>
        <ZonesField value={metrics.hr_zones} onChange={(v) => set("hr_zones", v)} />
      </section>

      <div
        className="sticky bottom-0 -mx-4 flex gap-2 px-4 pt-3 pb-[max(14px,env(safe-area-inset-bottom))]"
        style={{ background: "linear-gradient(transparent, var(--bg) 30%)" }}
      >
        <button className="btn flex-1" onClick={onCancel}>
          취소
        </button>
        <button className="btn btn-primary flex-[2]" onClick={save} disabled={busy || !date}>
          저장
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold">{children}</h2>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="muted text-xs">{label}</span>
      {children}
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <Field label={label}>
      <input
        className="input"
        inputMode="decimal"
        value={value ?? ""}
        placeholder="–"
        onChange={(e) => {
          const s = e.target.value.replace(/,/g, "").trim();
          if (s === "") return onChange(null);
          const n = Number(s);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
    </Field>
  );
}

function PaceField({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const toText = (v: number | null) =>
    v == null ? "" : `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}`;
  const [text, setText] = useState(toText(value));
  useEffect(() => setText(toText(value)), [value]);
  return (
    <Field label="평균 페이스 (분:초/100m)">
      <input
        className="input"
        inputMode="numeric"
        placeholder="2:30"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const m = text.trim().match(/^(\d+)[:'](\d{1,2})"?$/);
          if (!text.trim()) onChange(null);
          else if (m) onChange(Number(m[1]) * 60 + Number(m[2]));
          else setText(toText(value));
        }}
      />
    </Field>
  );
}

function ZonesField({ value, onChange }: { value: HrZones | null; onChange: (v: HrZones | null) => void }) {
  const z: HrZones = value ?? {
    zone1_min: null,
    zone2_min: null,
    zone3_min: null,
    zone4_min: null,
    zone5_min: null,
  };
  const keys = ["zone1_min", "zone2_min", "zone3_min", "zone4_min", "zone5_min"] as const;
  return (
    <div className="space-y-1">
      <span className="muted text-xs">심박수 영역별 시간 (분)</span>
      <div className="grid grid-cols-5 gap-1.5">
        {keys.map((k, i) => (
          <label key={k} className="block text-center">
            <span className="faint text-[11px]">영역 {i + 1}</span>
            <input
              className="input px-1 text-center"
              inputMode="decimal"
              placeholder="–"
              value={z[k] ?? ""}
              onChange={(e) => {
                const s = e.target.value.trim();
                const n = s === "" ? null : Number(s);
                if (n !== null && Number.isNaN(n)) return;
                const next = { ...z, [k]: n };
                onChange(Object.values(next).every((x) => x == null) ? null : next);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
