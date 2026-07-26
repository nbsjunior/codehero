"use client";
import { useState } from "react";

export default function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard API unavailable — no-op, user can still select+copy manually
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="hero-btn hero-btn-outline"
      style={{ padding: "0.6rem 0.9rem", fontSize: "0.8rem", whiteSpace: "nowrap" }}
    >
      {copied ? "Copiado ✓" : label}
    </button>
  );
}
