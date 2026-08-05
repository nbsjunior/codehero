/** PCA 2D simples para visualização offline (não supervisionado). */
export function pca2d(points: Float64Array[]): Array<{ x: number; y: number }> {
  if (points.length === 0) return [];
  const dim = points[0]!.length;
  const mean = new Float64Array(dim);
  for (const p of points) {
    for (let i = 0; i < dim; i++) mean[i]! += p[i]!;
  }
  for (let i = 0; i < dim; i++) mean[i]! /= points.length;

  const centered = points.map((p) => {
    const c = new Float64Array(dim);
    for (let i = 0; i < dim; i++) c[i] = p[i]! - mean[i]!;
    return c;
  });

  // Cov aproximada via power iteration nas duas primeiras direções.
  const power = (iters: number, avoid?: Float64Array): Float64Array => {
    let v = new Float64Array(dim);
    for (let i = 0; i < dim; i++) v[i] = ((i * 17 + 3) % 100) / 100 - 0.5;
    if (avoid) {
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += v[i]! * avoid[i]!;
      for (let i = 0; i < dim; i++) v[i]! -= dot * avoid[i]!;
    }
    for (let t = 0; t < iters; t++) {
      const w = new Float64Array(dim);
      for (const c of centered) {
        let dot = 0;
        for (let i = 0; i < dim; i++) dot += c[i]! * v[i]!;
        for (let i = 0; i < dim; i++) w[i]! += dot * c[i]!;
      }
      if (avoid) {
        let dot = 0;
        for (let i = 0; i < dim; i++) dot += w[i]! * avoid[i]!;
        for (let i = 0; i < dim; i++) w[i]! -= dot * avoid[i]!;
      }
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += w[i]! * w[i]!;
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < dim; i++) v[i] = w[i]! / norm;
    }
    return v;
  };

  const pc1 = power(25);
  const pc2 = power(25, pc1);

  return centered.map((c) => {
    let x = 0;
    let y = 0;
    for (let i = 0; i < dim; i++) {
      x += c[i]! * pc1[i]!;
      y += c[i]! * pc2[i]!;
    }
    return { x, y };
  });
}
