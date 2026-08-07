/**
 * Pure URL helpers — kept free of Admin SDK so unit tests stay lightweight.
 */

export function parseGithubUrl(url: string): { owner: string; repo: string; branch: string } | null {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/tree\/([^/#?]+))?\/?$/i);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, ""), branch: m[3] ?? "main" };
}
