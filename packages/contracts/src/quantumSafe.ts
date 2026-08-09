import type { HeroRule } from "./rules.ts";

// ---------------------------------------------------------------------------
// Regras de criptografia resistente a computador quântico.
//
// Por que isto é categoria própria e não parte de `weak-crypto`
// ---------------------------------------------------------------------------
// Um algoritmo fraco está errado HOJE: MD5 colide, DES tem chave curta demais.
// RSA e ECDH não estão nesse grupo — eles continuam corretos contra qualquer
// atacante que exista. O que muda é o horizonte: tráfego capturado hoje pode
// ser guardado e decifrado quando houver máquina para isso.
//
// Isso se chama "colher agora, decifrar depois", e tem uma consequência que
// muda a prioridade: o prazo não é quando a máquina existir, é quando o dado
// deixa de importar. Prontuário, contrato e segredo industrial com trinta anos
// de sigilo já estão expostos, mesmo que a máquina só apareça em 2035.
//
// Misturar as duas categorias esconderia justamente isso: um time que trocou
// MD5 por SHA-256 acharia que "criptografia está resolvida".
//
// De onde vêm os fatos
// ---------------------------------------------------------------------------
// Do `liboqs` e do `oqs-provider` do Open Quantum Safe, lidos no código:
//
//   - os nomes atuais são `ML-KEM-512/768/1024` e `ML-DSA-44/65/87`, que
//     substituíram Kyber e Dilithium na padronização do NIST. Não são o mesmo
//     algoritmo com nome novo: os parâmetros mudaram e as implementações não
//     interoperam;
//   - SIKE, SIDH e Rainbow FORAM REMOVIDOS do liboqs depois de quebrados. Não
//     estão mais no código fonte, o que é a forma mais clara de dizer "não
//     use";
//   - o `oqs-provider` nomeia os modos híbridos como `x25519_mlkem768`,
//     `p256_mlkem512`, `p384_mlkem1024`: clássico e pós-quântico juntos. É a
//     postura recomendada de migração, porque quebrar a combinação exige
//     quebrar os dois.
// ---------------------------------------------------------------------------

export const QUANTUM_SAFE_RULES: HeroRule[] = [
  {
    id: "HERO-PQC-0327-algoritmo-quebrado",
    name: "AlgoritmoPosQuanticoQuebrado",
    languages: ["python", "javascript", "typescript", "java", "csharp", "go"],
    severity: "BLOCKER",
    type: "VULNERABILITY",
    remediationEffortMin: 60,
    cwe: ["CWE-327"],
    owasp: ["A02:2021-Cryptographic Failures"],
    message:
      "Algoritmo pós-quântico QUEBRADO: SIKE e SIDH caíram em 2022 com um ataque que roda em um laptop em uma hora, e Rainbow caiu em 2022 também. O Open Quantum Safe removeu os três do código. Isto é pior que criptografia clássica, porque dá a impressão de proteção pós-quântica sem oferecer nenhuma.",
    sddTemplateId: "sdd.pqc.trocar-algoritmo-quebrado",
    category: "quantum-safe",
    implementation: "core",
    pattern: {
      // `scope: any`: o nome do algoritmo quase sempre é literal de string,
      // como `OQS_KEM_new("SIKE-p434")`. Com `code` a regra não veria nada,
      // que foi o defeito medido nas regras de cripto clássica.
      scope: "any",
      regex:
        "(?i)\\b(SIKEp?[0-9]{3}|SIKE-p[0-9]{3}|SIDHp?[0-9]{3}|SIDH-p[0-9]{3}|Rainbow-?(I|III|V)[a-z-]*|OQS_KEM_alg_sike|OQS_SIG_alg_rainbow)\\b",
      // "sike" aparece em prosa ("dislike", nomes próprios) e o `\b` sozinho
      // não basta em comentário.
      unless: "^\\s*(//|\\*|#|--)",
    },
  },

  {
    id: "HERO-PQC-0327-nome-pre-padronizacao",
    name: "NomePreviaPadronizacaoNist",
    languages: ["python", "javascript", "typescript", "java", "csharp", "go"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 45,
    cwe: ["CWE-327"],
    owasp: ["A02:2021-Cryptographic Failures"],
    message:
      "Nome anterior à padronização: Kyber virou ML-KEM e Dilithium virou ML-DSA. Não é a mesma coisa com nome novo — os parâmetros mudaram e as duas versões NÃO interoperam. Código preso ao nome antigo está preso a uma biblioteca antiga, e vai falhar ao conversar com quem já migrou.",
    sddTemplateId: "sdd.pqc.migrar-para-nome-nist",
    category: "quantum-safe",
    implementation: "core",
    pattern: {
      scope: "any",
      regex:
        "(?i)\\b(Kyber(512|768|1024)|Kyber-(512|768|1024)|OQS_KEM_alg_kyber|Dilithium(2|3|5)|Dilithium-(2|3|5)|OQS_SIG_alg_dilithium)\\b",
      unless: "^\\s*(//|\\*|#|--)",
    },
  },

  {
    id: "HERO-PQC-0326-nivel-insuficiente",
    name: "NivelDeSegurancaPosQuanticoBaixo",
    languages: ["python", "javascript", "typescript", "java", "csharp", "go"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 20,
    cwe: ["CWE-326"],
    owasp: ["A02:2021-Cryptographic Failures"],
    message:
      "Parâmetro pós-quântico de nível 1 (ML-KEM-512, ML-DSA-44). É o piso da escala do NIST e fica abaixo do que a CNSA 2.0 exige para sistema sensível, que pede nível 3 ou acima. Para dado com sigilo longo, o custo de subir para ML-KEM-768 é pequeno perto de refazer a migração depois.",
    sddTemplateId: "sdd.pqc.subir-nivel",
    category: "quantum-safe",
    implementation: "core",
    pattern: {
      scope: "any",
      regex:
        "(?i)\\b(ML-?KEM-?512|ML-?DSA-?44|OQS_KEM_alg_ml_kem_512|OQS_SIG_alg_ml_dsa_44|p256_mlkem512|falcon-?512)\\b",
      unless: "^\\s*(//|\\*|#|--)",
    },
  },

  {
    id: "HERO-PQC-0327-sem-hibrido",
    name: "PosQuanticoSemModoHibrido",
    languages: ["python", "javascript", "typescript", "java", "csharp", "go"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-327"],
    owasp: ["A02:2021-Cryptographic Failures"],
    message:
      "Troca de chaves pós-quântica pura, sem o par clássico. O `oqs-provider` oferece os modos híbridos (`x25519_mlkem768`, `p384_mlkem1024`) justamente porque os algoritmos pós-quânticos são jovens: no híbrido, quebrar a sessão exige quebrar os DOIS. Enquanto a análise criptográfica amadurece, apostar só no novo troca um risco conhecido por um desconhecido.",
    sddTemplateId: "sdd.pqc.usar-hibrido",
    category: "quantum-safe",
    implementation: "core",
    pattern: {
      scope: "any",
      // Só dispara na chamada de criação com o nome PURO. `x25519_mlkem768`
      // não casa porque o prefixo clássico está no mesmo token.
      regex:
        "(?i)(OQS_KEM_new|KeyEncapsulation|new\\s+KEM)\\s*\\(\\s*['\"](?!x25519_|p256_|p384_|p521_)(ML-?KEM-?(512|768|1024)|Kyber(512|768|1024))['\"]",
      unless: "^\\s*(//|\\*|#|--)",
    },
  },

  {
    id: "HERO-PQC-0311-colher-agora-decifrar-depois",
    name: "ColherAgoraDecifrarDepois",
    languages: ["python", "javascript", "typescript", "java", "csharp", "go"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 120,
    cwe: ["CWE-311", "CWE-327"],
    owasp: ["A02:2021-Cryptographic Failures"],
    message:
      "Troca de chaves clássica (RSA, DH ou ECDH) protegendo dado de sigilo longo. Não está quebrada hoje, e é esse o problema: o tráfego pode ser capturado agora e decifrado quando houver máquina. O prazo não é a chegada do computador quântico, é quanto tempo este dado precisa continuar secreto.",
    sddTemplateId: "sdd.pqc.migrar-troca-de-chaves",
    category: "quantum-safe",
    implementation: "core",
    pattern: {
      scope: "any",
      // Exige o verbo de ACORDO DE CHAVES junto do algoritmo. `RSA` sozinho
      // apareceria em toda linha que menciona certificado e afogaria a regra.
      regex:
        "(?i)(KeyAgreement\\.getInstance|generateKeyPair|KeyPairGenerator\\.getInstance|createECDH|createDiffieHellman|ECDH_compute_key|crypto\\.generateKeyPair)\\s*\\(\\s*['\"]?(RSA|DH|DiffieHellman|ECDH|EC)\\b",
      unless: "^\\s*(//|\\*|#|--)|mlkem|ml_kem|kyber|hybrid|hibrido",
    },
  },

  {
    id: "HERO-PQC-0347-assinatura-de-longa-duracao",
    name: "AssinaturaClassicaEmArtefatoDuradouro",
    languages: ["python", "javascript", "typescript", "java", "csharp", "go"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 90,
    cwe: ["CWE-347"],
    owasp: ["A02:2021-Cryptographic Failures"],
    message:
      "Assinatura clássica (RSA ou ECDSA) em artefato que vive muito: firmware, certificado raiz, imagem de contêiner. Diferente de sessão, artefato assinado continua sendo verificado por anos. Quando a assinatura puder ser forjada, o artefato já está instalado no campo, e trocar a raiz de confiança de um parque instalado é o tipo de projeto que ninguém quer começar às pressas.",
    sddTemplateId: "sdd.pqc.assinatura-hibrida",
    category: "quantum-safe",
    implementation: "core",
    pattern: {
      scope: "any",
      regex:
        "(?i)(Signature\\.getInstance|createSign|SignatureAlgorithm)\\s*\\(\\s*['\"](SHA(1|224|256|384|512)with(RSA|ECDSA)|RS(256|384|512)|ES(256|384|512)|PS(256|384|512))['\"]",
      unless: "^\\s*(//|\\*|#|--)|mldsa|ml_dsa|dilithium|falcon|sphincs|slh-?dsa",
    },
  },
];
