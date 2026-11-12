"use client";

import { useEffect, useRef, useState } from "react";
import type { HrZones } from "@/lib/types";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

/** 위가 둥근 막대 경로 (아래 기준선에 붙음) */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg px-2.5 py-1.5 text-xs shadow-lg"
      style={{
        left,
        top: y - 8,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        color: "var(--text)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="muted flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/* ---------------- 주간 운동 시간 (누적 막대) ---------------- */

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}
export interface StackDatum {
  label: string; // x축 라벨
  sub: string; // 툴팁 제목
  values: Record<string, number>;
}

export function StackedBars({
  data,
  series,
  unit,
}: {
  data: StackDatum[];
  series: StackSeries[];
  unit: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 180;
  const pad = { l: 34, r: 6, t: 10, b: 22 };
  const totals = data.map((d) => series.reduce((s, k) => s + (d.values[k.key] ?? 0), 0));
  const max = niceMax(Math.max(...totals, 1));
  const iw = width - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / data.length;
  const bw = Math.min(28, slot * 0.6);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={H} role="img" aria-label={`주별 운동 ${unit}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--text-3)">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          let acc = 0;
          const present = series.filter((s) => (d.values[s.key] ?? 0) > 0);
          return (
            <g key={i} opacity={hover == null || hover === i ? 1 : 0.55}>
              {present.map((s, j) => {
                const v = d.values[s.key];
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const isTop = j === present.length - 1;
                // 세그먼트 사이 2px 표면색 간격
                const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
                return isTop ? (
                  <path key={s.key} d={topRoundedRect(cx - bw / 2, y1, bw, h, 4)} fill={s.color} />
                ) : (
                  <rect key={s.key} x={cx - bw / 2} y={y1} width={bw} height={h} fill={s.color} />
                );
              })}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-3)">
                {d.label}
              </text>
              <rect
                x={pad.l + slot * i}
                y={pad.t}
                width={slot}
                height={ih}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tooltip x={pad.l + slot * hover + slot / 2} y={y(totals[hover])} width={width}>
          <div className="font-semibold">
            {data[hover].sub} · {Math.round(totals[hover])}
            {unit}
          </div>
          {series
            .filter((s) => (data[hover].values[s.key] ?? 0) > 0)
            .map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                <span className="muted">{s.label}</span>
                <span className="ml-auto pl-3 tabular-nums">
                  {Math.round(data[hover].values[s.key])}
                  {unit}
                </span>
              </div>
            ))}
        </Tooltip>
      )}
    </div>
  );
}

/* ---------------- 심박수 추이 (선) ---------------- */

export interface LinePoint {
  label: string; // 툴팁 제목
  axis: string; // x축 라벨
  values: Record<string, number | null>;
}

export function LineChart({
  data,
  series,
  unit,
}: {
  data: LinePoint[];
  series: StackSeries[];
  unit: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 180;
  const pad = { l: 34, r: 34, t: 12, b: 22 };
  const all = data.flatMap((d) => series.map((s) => d.values[s.key])).filter((v): v is number => v != null);
  const lo = Math.floor((Math.min(...all) - 5) / 10) * 10;
  const hi = Math.ceil((Math.max(...all) + 5) / 10) * 10;
  const iw = width - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const labelEvery = Math.ceil(data.length / 6);

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = data.length === 1 ? 0 : Math.round((px / r.width) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={H} role="img" aria-label={`운동별 심박수 (${unit})`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--text-3)">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) =>
          i % labelEvery === 0 || i === data.length - 1 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-3)">
              {d.axis}
            </text>
          ) : null,
        )}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--text-3)" strokeDasharray="3 3" />
        )}
        {series.map((s) => {
          const pts = data
            .map((d, i) => (d.values[s.key] != null ? ([x(i), y(d.values[s.key]!)] as const) : null))
            .filter((p): p is readonly [number, number] => p != null);
          const last = pts[pts.length - 1];
          const lastVal = [...data].reverse().find((d) => d.values[s.key] != null)?.values[s.key];
          return (
            <g key={s.key}>
              <polyline
                points={pts.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={3} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
              {last && lastVal != null && (
                <text x={last[0] + 6} y={last[1] + 4} fontSize="10" fill="var(--text-2)">
                  {Math.round(lastVal)}
                </text>
              )}
            </g>
          );
        })}
        <rect
          x={pad.l}
          y={pad.t}
          width={iw}
          height={ih}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover != null && (
        <Tooltip x={x(hover)} y={pad.t + 10} width={width}>
          <div className="font-semibold">{data[hover].label}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="muted">{s.label}</span>
              <span className="ml-auto pl-3 tabular-nums">
                {data[hover].values[s.key] != null ? `${Math.round(data[hover].values[s.key]!)} ${unit}` : "–"}
              </span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

/* ---------------- 심박수 영역 (가로 막대) ---------------- */

const ZONE_NAMES = ["영역 1 · 매우 가벼움", "영역 2 · 가벼움", "영역 3 · 보통", "영역 4 · 힘듦", "영역 5 · 최대"];

export function ZoneBars({ zones }: { zones: HrZones }) {
  const vals = [zones.zone1_min, zones.zone2_min, zones.zone3_min, zones.zone4_min, zones.zone5_min];
  const total = vals.reduce<number>((s, v) => s + (v ?? 0), 0);
  const max = Math.max(...vals.map((v) => v ?? 0), 1);
  return (
    <div className="space-y-2">
      {vals.map((v, i) => (
        <div key={i} className="space-y-0.5" title={`${ZONE_NAMES[i]}: ${v ?? 0}분`}>
          <div className="flex justify-between text-xs">
            <span className="muted">{ZONE_NAMES[i]}</span>
            <span className="tabular-nums">
              {v == null ? "–" : `${Math.round(v * 10) / 10}분`}
              {total > 0 && v != null && <span className="faint"> · {Math.round((v / total) * 100)}%</span>}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${((v ?? 0) / max) * 100}%`, background: `var(--zone-${i + 1})` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
