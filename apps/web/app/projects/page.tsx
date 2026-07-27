"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function RedirectInner() {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    const q = new URLSearchParams();
    const org = sp.get("org");
    const id = sp.get("id");
    const repo = sp.get("repo");
    if (org) q.set("org", org);
    if (id) q.set("id", id);
    if (repo) q.set("repo", repo);
    const qs = q.toString();
    router.replace(`/admin/${qs ? `?${qs}` : ""}#workspace`);
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
