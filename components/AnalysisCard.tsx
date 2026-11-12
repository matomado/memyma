import { INTENSITY_LABEL, type Analysis } from "@/lib/types";

export default function AnalysisCard({ analysis }: { analysis: Analysis }) {
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">✨ AI 분석</h2>
        <span className="chip text-xs" style={{ padding: "2px 10px" }}>
          강도 · {INTENSITY_LABEL[analysis.intensity]}
        </span>
      </div>
      <p className="text-[15px] leading-relaxed">{analysis.summary}</p>
      {analysis.highlights.length > 0 && (
        <Block title="눈에 띄는 점" items={analysis.highlights} />
      )}
      {analysis.comparison && (
        <div className="space-y-1">
          <h3 className="muted text-xs font-semibold">최근 기록과 비교</h3>
          <p className="text-sm leading-relaxed">{analysis.comparison}</p>
        </div>
      )}
      {analysis.suggestions.length > 0 && <Block title="다음엔 이렇게" items={analysis.suggestions} />}
      {analysis.unreadable.length > 0 && (
        <p className="faint text-xs">읽지 못한 항목: {analysis.unreadable.join(", ")}</p>
      )}
    </section>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-1">
      <h3 className="muted text-xs font-semibold">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
