/* eslint-disable no-process-env */

import { getEnv, setEnv } from '../src/env-utils'

describe('Environment Variable util', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeAll(() => {
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('gets environment variable correctly', () => {
    process.env.GITHUB_MAIN_PR_NUM = 'test value'
    expect(getEnv('GITHUB_MAIN_PR_NUM')).toBe('test value')
  })
  test('sets environment variable correctly', () => {
    setEnv('GITHUB_MAIN_PR_NUM', 'new value')
    expect(process.env.GITHUB_MAIN_PR_NUM).toBe('new value')
  })
  test('handles undefined case', () => {
    expect(getEnv('GITHUB_MAIN_PR_NUM')).toBe(undefined)
  })
})
