/** Derives a short display name for a repo from its GitHub URL — "owner/repo" when parseable. */
export function deriveRepoName(repoUrl: string): string {
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i);
  if (m) return `${m[1]}/${m[2]}`;
  return repoUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
