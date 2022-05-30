export type Phase =
  | 'UNSTARTED'
  | 'RUNNING'
  | 'COMPUTE_FP'
  | 'SHADOWED'
  | 'PURGE_OUTPUTS'
  | 'POSSIBLY_SKIP'
  | 'RUN_IT'
  | 'TERMINAL'
