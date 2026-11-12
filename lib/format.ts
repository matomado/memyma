export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fmtDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const w = "일월화수목금토"[dt.getDay()];
  return `${m}월 ${d}일 (${w})`;
}

export function fmtDuration(min: number | null | undefined) {
  if (min == null) return "–";
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}시간 ${m}분` : `${m}분`;
}

export function fmtPace(sec: number | null | undefined) {
  if (sec == null) return "–";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}'${String(s).padStart(2, "0")}"/100m`;
}

export function fmtNum(n: number | null | undefined, unit = "") {
  if (n == null) return "–";
  return `${Math.round(n).toLocaleString("ko-KR")}${unit}`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
