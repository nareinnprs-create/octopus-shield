/** Drop inherited Shield history paths so nested apps cannot reuse the outer pane's worktree history. */

/** Must match hashWorktreeId. */
const WORKTREE_HASH = '[0-9a-f]{16}'
const HISTORY_FILE = '(?:zsh|bash)_history'

// Match layout rather than a resolved root: daemon and relay cannot derive desktop userData.
const OSHIELD_MINTED_HISTFILE = new RegExp(
  '/(?:' +
    // Desktop: <userData>/terminal-history/<hash>/<file>
    `terminal-history/${WORKTREE_HASH}/${HISTORY_FILE}` +
    '|' +
    // Desktop WSL retains this tail after translation to /mnt/<drive>/... .
    `terminal-history-wsl/[^/]+/${WORKTREE_HASH}/${HISTORY_FILE}` +
    '|' +
    // Relay: ~/.shield-remote/terminal-history/<hash>-<file>
    `\\.shield-remote/terminal-history/${WORKTREE_HASH}-${HISTORY_FILE}` +
    ')$'
)

export function isShieldMintedHistFile(value: string | undefined): boolean {
  return typeof value === 'string' && OSHIELD_MINTED_HISTFILE.test(value.replace(/\\/g, '/'))
}

export function dropInheritedShieldHistFile(env: Record<string, string | undefined>): void {
  if (isShieldMintedHistFile(env.HISTFILE)) {
    delete env.HISTFILE
  }
}
