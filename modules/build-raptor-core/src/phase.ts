export type Phase =
  | 'UNSTARTED'
  | 'RUNNING'
  | 'CHECK_SHADOWING'
  | 'PURGE_OUTPUTS'
  | 'POSSIBLY_SKIP'
  | 'RUN_IT'
  | 'TERMINAL'
