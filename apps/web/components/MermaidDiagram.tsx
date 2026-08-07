"use client";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Renders a Mermaid diagram client-side (works with Next static export).
 * Defers the heavy mermaid chunk until the figure enters the viewport.
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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
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
          // O `chart` vem de constantes do repositório, não de entrada de
          // usuário. Sem o modo strict do Mermaid, isto seria XSS.
          hostRef.current.innerHTML = svg; // sanitize: securityLevel strict do Mermaid
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
  }, [chart, reactId, visible]);

  return (
    <figure className="cr-docs-diagram">
      <div ref={hostRef} className="cr-docs-diagram-canvas" role="img" aria-label={caption ?? "Diagrama"} />
      {error ? <p className="cr-docs-diagram-error">{error}</p> : null}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
