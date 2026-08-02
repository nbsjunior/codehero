# Joern CPG queries (reference)
#
# O runner usa `joern-scan` quando disponível. Queries customizadas podem ser
# executadas via `joern --script` apontando para este diretório — ver
# https://docs.joern.io
#
# Exemplo de intenção (pseudo):
#   cpg.call.name(".*executeQuery.*").argument.reachableBy(cpg.method(".*Handler.*"))
#
# O CodeHero importa o SARIF resultante com proveniência EXT:joern:<rule>.
