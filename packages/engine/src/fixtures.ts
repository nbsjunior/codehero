/**
 * Fixtures for deep engine (AST/taint) — used by scanner integration checks.
 */
export const FIXTURE_SQLI = `
export function handler(req, db) {
  const id = req.query.id;
  return db.query("SELECT * FROM users WHERE id = " + id);
}
`;

export const FIXTURE_XSS = `
export function render(req, el) {
  const name = req.params.name;
  el.innerHTML = "<h1>" + name + "</h1>";
}
`;

export const FIXTURE_SAFE = `
export function handler(req, db) {
  const id = req.query.id;
  return db.query("SELECT * FROM users WHERE id = ?", [id]);
}
`;
