export {
  DEFAULT_EMBED_DIM,
  FUNCTION_NODE_TYPES,
  embedPaths,
  embedFunctionAst,
  extractAstPaths,
  cosine,
  euclidean,
  fnv1a,
} from "./embed.ts";
export { kmeans, chooseK } from "./kmeans.ts";
export type { KMeansResult } from "./kmeans.ts";
export { pca2d } from "./pca.ts";
export {
  clusterRepository,
  extractFunctions,
  indexByFile,
  findFamilyForLine,
} from "./cluster.ts";
export type { ClusterReport, ClusterOptions, FunctionUnit } from "./cluster.ts";
export { annotateSarifWithClusters } from "./annotate.ts";
export type { SarifLike } from "./annotate.ts";
