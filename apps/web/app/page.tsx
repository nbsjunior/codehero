"use client";
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "@/components/AuthGate";

function RedirectInner() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/#instalacao");
  }, [router]);
  return <p className="hero-caption" style={{ padding: "2rem" }}>Abrindo o painel…</p>;
}

/** Home redireciona para o painel unificado (menu Instalação). */
export default function HomePage() {
  return (
    <AuthGate>
      <Suspense fallback={<p className="hero-caption" style={{ padding: "2rem" }}>Abrindo…</p>}>
        <RedirectInner />
      </Suspense>
    </AuthGate>
  );
}
