import type { Exercise, ExerciseSet, Workout } from "./types";

export const COMMON_EXERCISES = [
  "스쿼트",
  "데드리프트",
  "루마니안 데드리프트",
  "벤치프레스",
  "인클라인 벤치프레스",
  "덤벨 프레스",
  "오버헤드 프레스",
  "숄더 프레스 머신",
  "사이드 레터럴 레이즈",
  "바벨 로우",
  "덤벨 로우",
  "랫풀다운",
  "시티드 로우",
  "풀업",
  "레그 프레스",
  "레그 익스텐션",
  "레그 컬",
  "런지",
  "힙 쓰러스트",
  "힙 어브덕션",
  "케이블 플라이",
  "체스트 프레스 머신",
  "바이셉 컬",
  "트라이셉 푸시다운",
  "케틀벨 스윙",
  "플랭크",
];

const n = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

export function fmtSet(s: ExerciseSet) {
  const w = s.weight_kg != null ? `${n(s.weight_kg)}kg` : "맨몸";
  return s.reps != null ? `${w}×${s.reps}` : w;
}

/** 같은 세트는 묶어서: "60kg×5 ×3세트, 70kg×3" */
export function summarizeSets(sets: ExerciseSet[]) {
  const valid = sets.filter((s) => s.weight_kg != null || s.reps != null);
  if (!valid.length) return "기록 없음";
  const groups: { label: string; count: number }[] = [];
  for (const s of valid) {
    const label = fmtSet(s);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.count++;
    else groups.push({ label, count: 1 });
  }
  return groups.map((g) => (g.count > 1 ? `${g.label} ×${g.count}세트` : g.label)).join(", ");
}

export function volume(ex: Exercise) {
  return ex.sets.reduce((s, x) => s + (x.weight_kg ?? 0) * (x.reps ?? 0), 0);
}

export function topWeight(ex: Exercise): number | null {
  const ws = ex.sets.map((s) => s.weight_kg).filter((w): w is number => w != null);
  return ws.length ? Math.max(...ws) : null;
}

export function totalReps(ex: Exercise) {
  return ex.sets.reduce((s, x) => s + (x.reps ?? 0), 0);
}

export const normName = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 비어 있는 종목/세트는 빼고 정리 */
export function cleanExercises(list: Exercise[]): Exercise[] {
  return list
    .map((e) => ({
      ...e,
      name: e.name.trim(),
      sets: e.sets.filter((s) => s.weight_kg != null || s.reps != null),
    }))
    .filter((e) => e.name && e.sets.length);
}

/** 어떤 종목의 지난 기록들 (최신순). workouts는 최신순 정렬 상태 */
export function exerciseHistory(workouts: Workout[], name: string, excludeId?: string) {
  const key = normName(name);
  const out: { workout: Workout; exercise: Exercise }[] = [];
  for (const w of workouts) {
    if (w.id === excludeId) continue;
    for (const e of w.exercises ?? []) if (normName(e.name) === key) out.push({ workout: w, exercise: e });
  }
  return out;
}

/** 기록된 모든 종목 이름 (많이 한 순) */
export function allExerciseNames(workouts: Workout[]) {
  const count = new Map<string, { name: string; c: number }>();
  for (const w of workouts)
    for (const e of w.exercises ?? []) {
      const k = normName(e.name);
      const cur = count.get(k);
      count.set(k, { name: cur?.name ?? e.name, c: (cur?.c ?? 0) + 1 });
    }
  return [...count.values()].sort((a, b) => b.c - a.c).map((x) => x.name);
}
