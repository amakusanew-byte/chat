export default function ThinkingBlock({ thinking, live }: { thinking: string; live?: boolean }) {
  if (!thinking) return null;
  return (
    <details className="thinking" open={live}>
      <summary>
        {live ? <span className="pulse">💭 Sedang berpikir…</span> : "💭 Proses berpikir"}
      </summary>
      <pre>{thinking}</pre>
    </details>
  );
}
