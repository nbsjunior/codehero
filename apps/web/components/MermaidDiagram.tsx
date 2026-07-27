"use client";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Renders a Mermaid diagram client-side (works with Next static export).
 */
export default function MermaidDiagram({
  chart,
  caption,
}: {
  chart: string;
  caption?: string;
}) {
  const reactId = useId().replace(/:/g, "");
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!hostRef.current) return;
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          fontFamily: "Plus Jakarta Sans, Inter, sans-serif",
          themeVariables: {
            primaryColor: "#1a1520",
            primaryTextColor: "#f4f3ee",
            primaryBorderColor: "#e8121f",
            lineColor: "#a3a196",
            secondaryColor: "#121018",
            tertiaryColor: "#0f0d14",
            background: "#09080c",
            mainBkg: "#1a1520",
            nodeBorder: "#5a5466",
            clusterBkg: "#121018",
            titleColor: "#f4f3ee",
            edgeLabelBackground: "#121018",
          },
        });
        const id = `mermaid-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg } = await mermaid.render(id, chart.trim());
        if (!cancelled && hostRef.current) {
          hostRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao renderizar diagrama.");
        }
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [chart, reactId]);

  return (
    <figure className="cr-docs-diagram">
      <div ref={hostRef} className="cr-docs-diagram-canvas" role="img" aria-label={caption ?? "Diagrama"} />
      {error ? <p className="cr-docs-diagram-error">{error}</p> : null}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
