export type WorkoutType = "swim_lesson" | "swim_free" | "gym_pt" | "gym_solo";
export type Category = "swim" | "gym";
export type Intensity = "easy" | "moderate" | "hard" | "very_hard";

export const WORKOUT_TYPES: {
  id: WorkoutType;
  category: Category;
  label: string;
  short: string;
  emoji: string;
}[] = [
  { id: "swim_lesson", category: "swim", label: "수영 · 강습", short: "수영강습", emoji: "🏊" },
  { id: "swim_free", category: "swim", label: "수영 · 자유수영", short: "자유수영", emoji: "🌊" },
  { id: "gym_pt", category: "gym", label: "헬스 · PT 수업", short: "PT", emoji: "🏋️" },
  { id: "gym_solo", category: "gym", label: "헬스 · 개인운동", short: "개인운동", emoji: "💪" },
];

export function typeInfo(t: WorkoutType) {
  return WORKOUT_TYPES.find((w) => w.id === t)!;
}

export const INTENSITY_LABEL: Record<Intensity, string> = {
  easy: "가벼움",
  moderate: "보통",
  hard: "힘듦",
  very_hard: "매우 힘듦",
};

export interface HrZones {
  zone1_min: number | null;
  zone2_min: number | null;
  zone3_min: number | null;
  zone4_min: number | null;
  zone5_min: number | null;
}

/** 애플워치 캡처에서 읽어 오거나 직접 입력하는 수치들 */
export interface Metrics {
  duration_min: number | null;
  active_kcal: number | null;
  total_kcal: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  min_hr: number | null;
  distance_m: number | null;
  laps: number | null;
  pool_length_m: number | null;
  avg_pace_sec_per_100m: number | null;
  hr_zones: HrZones | null;
}

export interface Analysis {
  summary: string;
  intensity: Intensity;
  highlights: string[];
  suggestions: string[];
  comparison: string;
  unreadable: string[];
}

export interface ExerciseSet {
  weight_kg: number | null; // 맨몸이면 null
  reps: number | null;
}

export interface Exercise {
  id: string;
  name: string;
  sets: ExerciseSet[];
}

export interface Workout {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:MM
  type: WorkoutType;
  metrics: Metrics;
  memo: string;
  /** 헬스 종목별 세트 기록 (수영은 비어 있음) */
  exercises?: Exercise[];
  analysis: Analysis | null;
  createdAt: string;
  updatedAt: string;
}

export function emptyMetrics(): Metrics {
  return {
    duration_min: null,
    active_kcal: null,
    total_kcal: null,
    avg_hr: null,
    max_hr: null,
    min_hr: null,
    distance_m: null,
    laps: null,
    pool_length_m: null,
    avg_pace_sec_per_100m: null,
    hr_zones: null,
  };
}

/** API 요청/응답 */
export interface RecentSummary {
  date: string;
  type: WorkoutType;
  duration_min: number | null;
  active_kcal: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  distance_m: number | null;
  exercises?: string[];
}

export interface AnalyzeRequest {
  type: WorkoutType;
  memo: string;
  images: { media_type: "image/jpeg" | "image/png"; data: string }[];
  /** 이미 입력돼 있는 값(캡처 없이 직접 입력한 경우 분석만 받기 위해) */
  metrics?: Metrics;
  /** 헬스 종목 기록 요약 (예: "스쿼트: 60kg×5 ×3세트") */
  exercises?: string[];
  recent: RecentSummary[];
  today: string;
}

export interface AnalyzeResponse {
  date: string | null;
  start_time: string | null;
  metrics: Metrics;
  analysis: Analysis;
}
