import { describe, expect, it } from 'vitest'
import {
  extractGitHubIssueSourceError,
  extractGitHubIssueSourceFallback
} from './github-work-item-source-errors'

describe('extractGitHubIssueSourceError', () => {
  it('keeps the failing issue source slug with the repo that produced it', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/shield' },
        {
          sources: { issues: { owner: 'upstream', repo: 'shield' } },
          errors: { issues: { message: 'HTTP 403: resource not accessible' } }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/shield',
      source: { owner: 'upstream', repo: 'shield' },
      message: 'HTTP 403: resource not accessible'
    })
  })

  it('drops issue errors when the source slug is unavailable', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/shield' },
        {
          sources: { issues: null },
          errors: { issues: { message: 'failed' } }
        }
      )
    ).toBeNull()
  })

  it('returns null when the envelope has no issue-side error', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/shield' },
        {
          sources: { issues: { owner: 'octopusshield', repo: 'shield' } }
        }
      )
    ).toBeNull()
  })
})

describe('extractGitHubIssueSourceFallback', () => {
  it('reports the repo whose upstream issue source fell back to origin', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/shield', displayName: 'shield' },
        {
          issueSourceFellBack: true,
          sources: {
            issues: { owner: 'octopusshield', repo: 'shield-fork' },
            prs: { owner: 'octopusshield', repo: 'shield' }
          }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/shield',
      repoLabel: 'octopusshield/octopus-shield'
    })
  })

  it('uses the Shield repo display name when the PR source is unavailable', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/shield', displayName: 'shield' },
        {
          issueSourceFellBack: true,
          sources: { issues: null, prs: null }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/shield',
      repoLabel: 'shield'
    })
  })

  it('returns null when the source resolver did not fall back', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/shield', displayName: 'shield' },
        {
          sources: { issues: { owner: 'octopusshield', repo: 'shield' } }
        }
      )
    ).toBeNull()
  })
})
