export type Phase =
  | 'UNSTARTED'
  | 'RUNNING'
  | 'SHADOWED'
  | 'PURGE_OUTPUTS'
  | 'POSSIBLY_SKIP'
  | 'RUN_IT'
  | 'TERMINAL'
