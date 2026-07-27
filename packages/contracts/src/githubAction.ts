/** Production base URL for CodeHero Cloud Functions (internal / ops only). */
export const CODEHERO_FUNCTIONS_BASE_URL = "https://us-central1-apponti.cloudfunctions.net";

/** Hosted portal — all customer-facing HTTP (OAuth, CI ingest, rules). */
export const CODEHERO_PORTAL_ORIGIN = "https://codehero.web.app";

/**
 * Public API base that customers and CI use. Hosting rewrites `/api/*` to
 * Cloud Functions so repos never need to know about Firebase URLs.
 */
export const CODEHERO_PUBLIC_API_BASE = `${CODEHERO_PORTAL_ORIGIN}/api`;

/** Canonical OAuth callback path prefix on the portal (before `/{slug}/…`). */
export const CODEHERO_GITHUB_OAUTH_CALLBACK_SUFFIX = "githubOauthCallback";

/** Slugify a project display name for portal URLs. */
export function slugifyProjectName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "projeto";
}

/** Portal OAuth callback for a given project slug (customer-visible URL). */
export function codeHeroGithubOAuthCallbackUrl(projectSlug: string): string {
  const slug = slugifyProjectName(projectSlug);
  return `${CODEHERO_PORTAL_ORIGIN}/${encodeURIComponent(slug)}/${CODEHERO_GITHUB_OAUTH_CALLBACK_SUFFIX}`;
}

/**
 * Generates the customer-facing GitHub Actions workflow that runs the CodeHero
 * composite action against a linked org/project.
 */
export function buildCodeHeroWorkflowYaml(
  orgId: string,
  projectId: string,
  opts?: { defaultBranch?: string },
): string {
  const branch = (opts?.defaultBranch ?? "main").trim() || "main";
  return `name: CodeHero Analysis
on:
  pull_request:
  push:
    branches: [${branch}]

jobs:
  codehero:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: nbsjunior/codehero/packages/github-action@main
        with:
          server-url: \${{ vars.HERO_CORE_URL }}
          token: \${{ secrets.HERO_TOKEN }}
          org-id: "${orgId}"
          project-id: "${projectId}"
          path: "."
          fail-on: CRITICAL
`;
}

/** Shell snippet to set Actions secret + variable via GitHub CLI. */
export function buildGithubCliSetupScript(input: {
  owner: string;
  repo: string;
  heroCoreUrl: string;
  ingestToken: string;
}): string {
  const repo = `${input.owner}/${input.repo}`;
  return `# CodeHero — secrets/vars no repositório (requer GitHub CLI: https://cli.github.com)
gh secret set HERO_TOKEN --repo ${repo} --body '${input.ingestToken.replace(/'/g, `'\\''`)}'
gh variable set HERO_CORE_URL --repo ${repo} --body '${input.heroCoreUrl.replace(/'/g, `'\\''`)}'
`;
}
