import { describe, expect, it } from 'vitest'
import { parseShieldBrowserCommand } from './shield-browser-cli-commands'

describe('parseShieldBrowserCommand', () => {
  it.each([
    ['shield click --element e3', null],
    ['shield snapshot --page p1', 'p1'],
    ['shield-dev fill --element e2 --text hi --page=p2', 'p2'],
    ["shield goto --url https://example.com --page='p3'", 'p3'],
    ['/Users/me/.local/bin/shield screenshot', null],
    ['C:\\Users\\me\\shield\\shield.cmd tab create', null],
    ['shield-ide mouse move --x 1 --y 2', null],
    ['cd app && shield click --element e3 --page p4', 'p4'],
    ['git status; OSHIELD_DEBUG=1 shield tab list', null],
    ['shield snapshot | head -20', null],
    ['shield browser identity get', null]
  ])('matches %s', (command, pageId) => {
    expect(parseShieldBrowserCommand(command)).toEqual({ pageId })
  })

  it.each([
    'shield worktree ls',
    'shield terminal send --text "shield click"',
    'shieldstra click',
    'shield',
    'echo shield click',
    'echo "docs; shield snapshot --page p1; text"',
    "git commit -m 'run shield click | shield snapshot'",
    'git log --oneline'
  ])('does not match %s', (command) => {
    expect(parseShieldBrowserCommand(command)).toBeNull()
  })
})
