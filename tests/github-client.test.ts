import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAllReposInfo, getRepoDefaultBranch } from '../src/lib/github-client'
import { Octokit } from 'octokit'

vi.mock('octokit', () => {
  const Octokit = vi.fn()
  Octokit.prototype.rest = {
    repos: {
      listForAuthenticatedUser: vi.fn(),
      get: vi.fn(),
    }
  }
  Octokit.prototype.paginate = vi.fn()
  return { Octokit }
})

describe('getAllReposInfo', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv, GITHUB_OWNER: 'test-owner', GITHUB_PAT: 'test-token' }
    vi.clearAllMocks()
  })

  it('fetches and filters repositories correctly with Dependabot alerts', async () => {
    const mockRepos = [
      {
        name: 'repo1',
        owner: { login: 'test-owner' },
        html_url: 'https://github.com/test-owner/repo1',
        archived: false,
      },
      {
        name: 'repo2',
        owner: { login: 'other-owner' },
        html_url: 'https://github.com/other-owner/repo2',
        archived: false,
      },
      {
        name: 'repo3',
        owner: { login: 'test-owner' },
        html_url: 'https://github.com/test-owner/repo3',
        archived: true,
      },
    ]

    const octokitInstance = new Octokit()
    vi.mocked(octokitInstance.paginate).mockResolvedValue(mockRepos as any)

    octokitInstance.rest.dependabot = {
      listAlertsForRepo: vi.fn().mockImplementation(async ({ repo }) => {
        if (repo === 'repo1') {
          return { data: [{ number: 1 }, { number: 2 }] }
        }
        return { data: [] }
      }),
    } as any

    octokitInstance.rest.pulls = {
      list: vi.fn().mockImplementation(async ({ repo }) => {
        if (repo === 'repo1') {
          return { data: [{ id: 101 }, { id: 102 }, { id: 103 }] }
        }
        return { data: [] }
      }),
    } as any

    const result = await getAllReposInfo()

    expect(result.size).toBe(1)
    expect(result.has('repo1')).toBe(true)
    expect(result.has('repo2')).toBe(false)
    expect(result.has('repo3')).toBe(false) // Archived should be excluded

    const repo1 = result.get('repo1')
    expect(repo1?.repoUrl).toBe('https://github.com/test-owner/repo1')
    expect(repo1?.issueUrl).toBe('https://github.com/test-owner/repo1/issues')
    expect(repo1?.julesUrl).toContain('/test-owner/repo1/')
    expect(repo1?.hasDependabotAlerts).toBe(true)
    expect(repo1?.dependabotAlertsCount).toBe(2)
    expect(repo1?.dependabotUrl).toBe('https://github.com/test-owner/repo1/security/dependabot')
    expect(repo1?.openPullRequestsCount).toBe(3)
    expect(repo1?.pullRequestsUrl).toBe('https://github.com/test-owner/repo1/pulls')
  })

  it('skips Dependabot alerts and open PRs when options are false', async () => {
    const mockRepos = [
      {
        name: 'repo1',
        owner: { login: 'test-owner' },
        html_url: 'https://github.com/test-owner/repo1',
        archived: false,
      },
    ]

    const octokitInstance = new Octokit()
    vi.mocked(octokitInstance.paginate).mockResolvedValue(mockRepos as any)

    const listAlertsMock = vi.fn()
    const listPullsMock = vi.fn()
    octokitInstance.rest.dependabot = {
      listAlertsForRepo: listAlertsMock,
    } as any
    octokitInstance.rest.pulls = {
      list: listPullsMock,
    } as any

    const result = await getAllReposInfo({ includeDependabotAlerts: false, includeOpenPullRequests: false })

    expect(result.size).toBe(1)
    expect(listAlertsMock).not.toHaveBeenCalled()
    expect(listPullsMock).not.toHaveBeenCalled()
    const repo1 = result.get('repo1')
    expect(repo1?.hasDependabotAlerts).toBe(false)
    expect(repo1?.dependabotAlertsCount).toBe(0)
    expect(repo1?.openPullRequestsCount).toBe(0)
  })

  it('throws error if GITHUB_OWNER is not set', async () => {
    delete process.env.GITHUB_OWNER
    await expect(getAllReposInfo()).rejects.toThrow('GITHUB_OWNER is not set')
  })

  describe('getRepoDefaultBranch', () => {
    it('returns default_branch from GitHub API', async () => {
      const octokitInstance = new Octokit()
      vi.mocked(octokitInstance.rest.repos.get).mockResolvedValue({
        data: { default_branch: 'develop' }
      } as any)

      const branch = await getRepoDefaultBranch('test-owner', 'test-repo')
      expect(branch).toBe('develop')
    })

    it('falls back to "test" if GitHub API call fails', async () => {
      const octokitInstance = new Octokit()
      vi.mocked(octokitInstance.rest.repos.get).mockRejectedValue(new Error('API Error'))

      const branch = await getRepoDefaultBranch('test-owner', 'test-repo')
      expect(branch).toBe('test')
    })
  })
})
