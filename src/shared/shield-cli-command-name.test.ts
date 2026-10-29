import { describe, expect, it } from 'vitest'
import { installFakeAppEnvironment } from '../../config/scripts/vitest-host-ports-setup'
import { getTuiAgentLaunchCommand, TUI_AGENT_CONFIG } from './tui-agent-config'

const agentTeams = TUI_AGENT_CONFIG['claude-agent-teams']

describe('Claude Agent Teams launch name on the launching host', () => {
  it('uses plain shield on a headless Linux server, whose PATH has no shield-ide (#33920)', () => {
    installFakeAppEnvironment({ getCliLauncherPath: () => '/home/u/.shield/cli/bin/shield' })
    expect(getTuiAgentLaunchCommand(agentTeams, 'linux')).toBe('shield claude-teams')
  })

  it('keeps the shield-ide rename on a Linux desktop', () => {
    installFakeAppEnvironment({ getCliLauncherPath: undefined })
    expect(getTuiAgentLaunchCommand(agentTeams, 'linux')).toBe('shield-ide claude-teams')
  })

  it('keeps the shield-ide rename for WSL under a Windows server', () => {
    installFakeAppEnvironment({
      getCliLauncherPath: () => 'C:\\Users\\u\\.shield\\cli\\bin\\shield.exe'
    })
    expect(getTuiAgentLaunchCommand(agentTeams, 'linux')).toBe('shield-ide claude-teams')
  })
})
