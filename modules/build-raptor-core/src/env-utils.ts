type EnvVarName = 'GITHUB_SHA' | 'GITHUB_MAIN_PR_NUM' | 'CI'

export function getEnv(envVarName: EnvVarName) {
  return process.env[envVarName] // eslint-disable-line no-process-env
}

export function setEnv(envVarName: EnvVarName, value: string) {
  process.env[envVarName] = value // eslint-disable-line no-process-env
}
