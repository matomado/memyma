"use client";

import { useCallback, useEffect, useState } from "react";
import type { Workout } from "./types";

const KEY = "memyma.workouts.v1";
const PASS_KEY = "memyma.passcode";

function read(): Workout[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Workout[]) : [];
  } catch {
    return [];
  }
}

function write(list: Workout[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    alert("저장 공간에 저장하지 못했어요. 백업(내보내기)을 먼저 해 두세요.");
  }
}

export function sortWorkouts(list: Workout[]) {
  return [...list].sort((a, b) =>
    a.date === b.date
      ? (b.startTime ?? "").localeCompare(a.startTime ?? "") || b.createdAt.localeCompare(a.createdAt)
      : b.date.localeCompare(a.date),
  );
}

export function useWorkouts() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setWorkouts(sortWorkouts(read()));
    setLoaded(true);
  }, []);

  const commit = useCallback((next: Workout[]) => {
    const sorted = sortWorkouts(next);
    write(sorted);
    setWorkouts(sorted);
  }, []);

  const upsert = useCallback(
    (w: Workout) => {
      const list = read();
      const i = list.findIndex((x) => x.id === w.id);
      if (i >= 0) list[i] = w;
      else list.push(w);
      commit(list);
    },
    [commit],
  );

  const remove = useCallback((id: string) => commit(read().filter((w) => w.id !== id)), [commit]);

  const replaceAll = useCallback((list: Workout[]) => commit(list), [commit]);

  return { workouts, loaded, upsert, remove, replaceAll };
}

export function getPasscode() {
  try {
    return localStorage.getItem(PASS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPasscode(v: string) {
  try {
    localStorage.setItem(PASS_KEY, v);
  } catch {
    /* ignore */
  }
}
