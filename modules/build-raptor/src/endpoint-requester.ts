import axios from 'axios'

import { GithubResponseSchema } from './build-raptor-api'

export async function getPrForCommit(
  commitHash: string,
  repoName: string,
  gitToken: string,
): Promise<number | undefined> {
  if (!commitHash || !commitHash.match(/^[a-f0-9]{40}$/)) {
    throw new Error('Invalid commit hash.')
  }

  const response = await axios.get(`https://api.github.com/repos/${repoName}/commits/${commitHash}/pulls`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${gitToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  const parsedData = GithubResponseSchema.parse(response.data)

  if (parsedData.length > 0) {
    return parsedData[0].number
  }

  // nothing found
  return
}
