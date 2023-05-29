import axios from 'axios'

import { GithubResponseSchema } from './build-raptor-api'
import { getEnv } from './build-raptor-cli'

export async function getPRForCommit(commitHash: string): Promise<number | undefined> {
  if (!commitHash || !commitHash.match(/^[a-f0-9]{40}$/)) {
    throw new Error('Invalid commit hash.')
  }

  const repoOwner = getEnv('GITHUB_REPOSITORY_OWNER')
  const repoName = getEnv('GITHUB_REPOSITORY')

  if (!repoOwner || !repoName) {
    throw new Error('Required repo environment variable(s) missing or invalid.')
  }

  const response = await axios.get(
    `https://api.github.com/repos/${repoOwner}/${repoName}/commits/${commitHash}/pulls`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${getEnv('GITHUB_TOKEN')}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )

  const parsedData = GithubResponseSchema.parse(response.data)

  if (parsedData.length > 0) {
    return parsedData[0].number
  }

  return
}
