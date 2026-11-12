"use client";

import { useState } from "react";
import { useWorkouts } from "@/lib/storage";
import type { Workout } from "@/lib/types";
import Dashboard from "@/components/Dashboard";
import WorkoutList from "@/components/WorkoutList";
import WorkoutEditor from "@/components/WorkoutEditor";
import WorkoutDetail from "@/components/WorkoutDetail";
import Settings from "@/components/Settings";

type View =
  | { name: "home" }
  | { name: "list" }
  | { name: "settings" }
  | { name: "edit"; workout?: Workout }
  | { name: "detail"; id: string };

export default function Page() {
  const { workouts, loaded, upsert, remove, replaceAll } = useWorkouts();
  const [view, setView] = useState<View>({ name: "home" });

  const go = (v: View) => {
    setView(v);
    window.scrollTo(0, 0);
  };
  const openDetail = (id: string) => go({ name: "detail", id });

  let body: React.ReactNode = null;
  if (!loaded) {
    body = <p className="faint p-6 text-center">불러오는 중…</p>;
  } else if (view.name === "home") {
    body = <Dashboard workouts={workouts} onOpen={openDetail} onAdd={() => go({ name: "edit" })} />;
  } else if (view.name === "list") {
    body = <WorkoutList workouts={workouts} onOpen={openDetail} />;
  } else if (view.name === "settings") {
    body = <Settings workouts={workouts} onImport={replaceAll} />;
  } else if (view.name === "edit") {
    body = (
      <WorkoutEditor
        initial={view.workout}
        workouts={workouts}
        onCancel={() => (view.workout ? openDetail(view.workout.id) : go({ name: "home" }))}
        onSave={(w) => {
          upsert(w);
          openDetail(w.id);
        }}
      />
    );
  } else if (view.name === "detail") {
    const w = workouts.find((x) => x.id === view.id);
    body = w ? (
      <WorkoutDetail
        workout={w}
        workouts={workouts}
        onBack={() => go({ name: "list" })}
        onEdit={() => go({ name: "edit", workout: w })}
        onDelete={() => {
          if (confirm("이 기록을 삭제할까요?")) {
            remove(w.id);
            go({ name: "list" });
          }
        }}
      />
    ) : (
      <p className="faint p-6 text-center">기록을 찾을 수 없어요.</p>
    );
  }

  const tab = view.name === "detail" ? "list" : view.name;

  return (
    <div className="mx-auto min-h-dvh max-w-xl pb-28">
      <header className="flex items-center justify-between px-4 pt-[max(16px,env(safe-area-inset-top))] pb-2">
        <button className="text-xl font-bold tracking-tight" onClick={() => go({ name: "home" })}>
          memyma
        </button>
        <span className="faint text-sm">수영 · 헬스 기록</span>
      </header>

      <main className="px-4">{body}</main>

      {view.name !== "edit" && (
        <nav
          className="fixed inset-x-0 bottom-0 border-t"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="mx-auto grid max-w-xl grid-cols-4 px-2 pt-2 pb-[max(10px,env(safe-area-inset-bottom))] text-center text-xs">
            <NavBtn active={tab === "home"} onClick={() => go({ name: "home" })} icon="📊" label="요약" />
            <NavBtn active={tab === "list"} onClick={() => go({ name: "list" })} icon="📋" label="기록" />
            <NavBtn active={false} onClick={() => go({ name: "edit" })} icon="➕" label="새 기록" strong />
            <NavBtn
              active={tab === "settings"}
              onClick={() => go({ name: "settings" })}
              icon="⚙️"
              label="설정"
            />
          </div>
        </nav>
      )}
    </div>
  );
}

function NavBtn(props: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  strong?: boolean;
}) {
  return (
    <button
      onClick={props.onClick}
      className="flex flex-col items-center gap-0.5 rounded-lg py-1"
      style={{ color: props.active || props.strong ? "var(--text)" : "var(--text-3)" }}
      aria-current={props.active ? "page" : undefined}
    >
      <span className="text-lg leading-none" aria-hidden>
        {props.icon}
      </span>
      <span className={props.active || props.strong ? "font-semibold" : ""}>{props.label}</span>
    </button>
  );
}
