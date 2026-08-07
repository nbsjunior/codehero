"use client";
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import { useAuth } from "@/lib/useAuth";

/**
 * Home.
 *
 * Antes daqui o `AuthGate` devolvia uma tela de espera enquanto o estado de
 * login carregava, e como o site e exportado estatico esse era o HTML que ia
 * para producao: a pagina inicial servia a palavra "Carregando" e mais nada. A
 * landing so existia depois do JavaScript rodar.
 *
 * Isso tinha tres efeitos, todos medidos no site publicado:
 *   - em carga lenta a tela ficava vazia e parecia que o deploy tinha falhado;
 *   - o Google recebia uma pagina sem conteudo, anulando o trabalho de SEO;
 *   - qualquer falha do JavaScript deixava a home em branco.
 *
 * Agora a landing e o que o servidor entrega. Quem ja tem sessao e levado ao
 * painel depois da hidratacao, o que custa um instante para uma minoria e
 * entrega a pagina certa para todo o resto, inclusive para quem nao executa
 * JavaScript.
 */
function IrParaOPainel() {
  const router = useRouter();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading && user) router.replace("/admin/#instalacao");
  }, [router, user, loading]);
  return null;
}

export default function HomePage() {
  return (
    <AuthGate landingDurantePreload>
      <Suspense fallback={null}>
        <IrParaOPainel />
      </Suspense>
    </AuthGate>
  );
}
