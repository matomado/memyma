"use client";

import { useEffect, useRef, useState } from "react";
import type { Workout } from "@/lib/types";
import { getPasscode, setPasscode } from "@/lib/storage";
import { todayStr } from "@/lib/format";

export default function Settings({
  workouts,
  onImport,
}: {
  workouts: Workout[];
  onImport: (list: Workout[]) => void;
}) {
  const [pass, setPass] = useState("");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setPass(getPasscode()), []);

  function exportJson() {
    const blob = new Blob([JSON.stringify(workouts, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `memyma-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importJson(file: File) {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data) || !data.every((w) => w && w.id && w.date && w.type && w.metrics)) {
        throw new Error();
      }
      const byId = new Map(workouts.map((w) => [w.id, w]));
      for (const w of data as Workout[]) byId.set(w.id, w);
      onImport([...byId.values()]);
      alert(`${data.length}개 기록을 불러왔어요.`);
    } catch {
      alert("memyma 백업 파일이 아니에요.");
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">설정</h1>

      <section className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold">앱 암호</h2>
        <p className="faint text-xs leading-relaxed">
          서버에 APP_PASSCODE를 설정했다면 같은 값을 넣어 주세요. 설정하지 않았다면 비워 두면 됩니다.
        </p>
        <div className="flex gap-2">
          <input
            className="input"
            type="password"
            value={pass}
            onChange={(e) => {
              setPass(e.target.value);
              setSaved(false);
            }}
          />
          <button
            className="btn shrink-0"
            onClick={() => {
              setPasscode(pass);
              setSaved(true);
            }}
          >
            {saved ? "저장됨" : "저장"}
          </button>
        </div>
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold">백업</h2>
        <p className="faint text-xs leading-relaxed">
          기록은 이 브라우저에만 저장돼요. 브라우저 데이터를 지우거나 기기를 바꾸기 전에 내보내기로 백업해
          두세요. (현재 {workouts.length}개)
        </p>
        <div className="flex gap-2">
          <button className="btn flex-1" onClick={exportJson} disabled={!workouts.length}>
            내보내기
          </button>
          <button className="btn flex-1" onClick={() => fileRef.current?.click()}>
            불러오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = "";
            }}
          />
        </div>
      </section>
    </div>
  );
}
