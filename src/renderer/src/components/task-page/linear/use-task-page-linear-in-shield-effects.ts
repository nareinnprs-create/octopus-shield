import type { TaskPageLinearListEffectsModel } from './use-task-page-linear-list-effects'
import { useEffect } from 'react'
import {
  readLinkedLinearIssuesWithLimit,
  filterLinearIssuesForInShieldWorkspace
} from '@/components/task-page/linear/task-page-linear-in-shield-issues'
import type { LinearIssue } from '../../../../../shared/linear/issue-types'
import { translate } from '@/i18n/i18n'

function isCurrentLinearRequest(
  requestRef: React.RefObject<{ signature: string; nonce: number } | null>,
  signature: string,
  nonce: number
): boolean {
  return requestRef.current?.signature === signature && requestRef.current?.nonce === nonce
}

export function useTaskPageLinearInShieldEffects(model: TaskPageLinearListEffectsModel) {
  const {
    fetchLinearIssue,
    refreshLinearIssue,
    linearConnected,
    selectedLinearWorkspaceId,
    taskSource,
    linearTaskSourceContext,
    taskResumeApplied,
    linearMode,
    setLinearIssues,
    setLinearIssuesHasMore,
    setLinearLoading,
    setLinearError,
    linearRefreshNonce,
    lastLinearRequestRef,
    inShieldLinkedLinearRefsSignature,
    inShieldLinkedLinearRefsRef
  } = model
  // Why: Has Worktree loads Linear tickets linked on local worktrees, not a Linear list/search query.
  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (taskSource !== 'linear' || linearMode !== 'in-shield' || !linearConnected) {
      return
    }
    let cancelled = false
    const linkedRefs = inShieldLinkedLinearRefsRef.current
    const requestSignature = `in-shield::${selectedLinearWorkspaceId ?? 'default'}::${inShieldLinkedLinearRefsSignature}`
    const previousRequest = lastLinearRequestRef.current
    const isNewSignature = previousRequest?.signature !== requestSignature
    const forceRefresh = linearRefreshNonce > 0 && previousRequest?.nonce !== linearRefreshNonce
    lastLinearRequestRef.current = {
      nonce: linearRefreshNonce,
      signature: requestSignature
    }
    setLinearIssuesHasMore(false)
    setLinearError(null)
    if (linkedRefs.length === 0) {
      setLinearIssues([])
      setLinearLoading(false)
      return () => {
        cancelled = true
      }
    }
    if (isNewSignature) {
      setLinearIssues([])
    }
    setLinearLoading(true)
    // Explicit refresh must use refreshLinearIssue because fetchLinearIssue serves its TTL cache regardless of force.
    void readLinkedLinearIssuesWithLimit(linkedRefs, (ref) => {
      const read = forceRefresh ? refreshLinearIssue : fetchLinearIssue
      return read(ref.identifier, ref.workspaceId ?? selectedLinearWorkspaceId, {
        sourceContext: ref.sourceContext ?? linearTaskSourceContext
      })
    })
      .then((results) => {
        if (
          cancelled ||
          !isCurrentLinearRequest(lastLinearRequestRef, requestSignature, linearRefreshNonce)
        ) {
          return
        }
        const loaded = results.filter((issue): issue is LinearIssue => issue != null)
        // Reads resolve null on failure; all-null linked results must show failure rather than an unlinked empty state.
        if (loaded.length === 0) {
          setLinearError(
            translate(
              'auto.components.TaskPage.linearHasWorktreeLoadFailed',
              'Unable to load Linear issues linked to an Shield workspace.'
            )
          )
          setLinearIssues([])
          setLinearLoading(false)
          return
        }
        if (loaded.length !== results.length) {
          setLinearError(
            translate(
              'auto.components.TaskPage.linearHasWorktreePartialLoadFailed',
              'Some Linear issues linked to an Shield workspace could not be loaded. Refresh to try again.'
            )
          )
        }
        setLinearIssues(filterLinearIssuesForInShieldWorkspace(loaded, selectedLinearWorkspaceId))
        setLinearLoading(false)
      })
      .catch((err) => {
        if (
          cancelled ||
          !isCurrentLinearRequest(lastLinearRequestRef, requestSignature, linearRefreshNonce)
        ) {
          return
        }
        setLinearError(err instanceof Error ? err.message : 'Failed to load Linear issues.')
        setLinearLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Depend on link signatures rather than unrelated worktree activity so unchanged tickets are not re-read.
  }, [
    fetchLinearIssue,
    inShieldLinkedLinearRefsSignature,
    inShieldLinkedLinearRefsRef,
    lastLinearRequestRef,
    linearConnected,
    linearMode,
    linearRefreshNonce,
    linearTaskSourceContext,
    refreshLinearIssue,
    selectedLinearWorkspaceId,
    setLinearError,
    setLinearIssues,
    setLinearIssuesHasMore,
    setLinearLoading,
    taskResumeApplied,
    taskSource
  ])
  return model
}
export type TaskPageLinearInShieldEffectsModel = ReturnType<typeof useTaskPageLinearInShieldEffects>
