"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function RedirectInner() {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    const qs = sp.toString();
    router.replace(qs ? `/admin/?${qs}#workspace` : "/admin/#workspace");
  }, [router, sp]);
  return <p className="hero-caption" style={{ padding: "2rem" }}>Redirecionando para o painel…</p>;
}

export default function ProjectsRedirectPage() {
  return (
    <Suspense fallback={<p className="hero-caption" style={{ padding: "2rem" }}>Redirecionando…</p>}>
      <RedirectInner />
    </Suspense>
  );
}
