// Split suites rewrite platform and agent-home environment; capture and restore the host values.
export function createPtyIpcProcessEnvScope() {
  const savedOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
  const savedShieldOpenCodeConfigDir = process.env.OSHIELD_OPENCODE_CONFIG_DIR
  const savedShieldOpenCodeSourceConfigDir = process.env.OSHIELD_OPENCODE_SOURCE_CONFIG_DIR
  const savedPiAgentDir = process.env.PI_CODING_AGENT_DIR
  const savedShieldPiAgentDir = process.env.OSHIELD_PI_CODING_AGENT_DIR
  const savedShieldPiSourceAgentDir = process.env.OSHIELD_PI_SOURCE_AGENT_DIR
  const savedShieldCodexHome = process.env.OSHIELD_CODEX_HOME
  const savedShieldOmpAgentDir = process.env.OSHIELD_OMP_CODING_AGENT_DIR
  const savedShieldOmpSourceAgentDir = process.env.OSHIELD_OMP_SOURCE_AGENT_DIR
  const savedShieldOmpStatusExtension = process.env.OSHIELD_OMP_STATUS_EXTENSION
  const savedPrimeAgentDir = process.env.PRIME_AGENT_CODING_AGENT_DIR
  const savedShieldPrimeAgentSourceDir = process.env.OSHIELD_PRIME_AGENT_SOURCE_AGENT_DIR
  const savedShieldPrimeAgentStatusExtension = process.env.OSHIELD_PRIME_AGENT_STATUS_EXTENSION
  const savedShieldClaudeAgentStatusSettings = process.env.OSHIELD_CLAUDE_AGENT_STATUS_SETTINGS
  const savedProcessPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const savedDisableMacosLoginShell = process.env.OSHIELD_DISABLE_MACOS_LOGIN_SHELL
  const savedShieldUserDataPath = process.env.OSHIELD_USER_DATA_PATH

  function applyTestEnvDefaults() {
    // POSIX is the default fixture; Windows cases explicitly opt in.
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin'
    })
    // Disable the TCC argv wrapper except in its dedicated tests.
    process.env.OSHIELD_DISABLE_MACOS_LOGIN_SHELL = '1'
    delete process.env.OPENCODE_CONFIG_DIR
    delete process.env.OSHIELD_OPENCODE_SOURCE_CONFIG_DIR
    delete process.env.OSHIELD_OPENCODE_CONFIG_DIR
    delete process.env.OSHIELD_AGENT_HOOK_ENDPOINT
    delete process.env.OSHIELD_CLAUDE_AGENT_STATUS_SETTINGS
    delete process.env.PI_CODING_AGENT_DIR
    delete process.env.OSHIELD_PI_SOURCE_AGENT_DIR
    delete process.env.OSHIELD_PI_CODING_AGENT_DIR
    delete process.env.OSHIELD_CODEX_HOME
    delete process.env.OSHIELD_OMP_SOURCE_AGENT_DIR
    delete process.env.OSHIELD_OMP_CODING_AGENT_DIR
    delete process.env.OSHIELD_OMP_STATUS_EXTENSION
    delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    delete process.env.OSHIELD_PRIME_AGENT_SOURCE_AGENT_DIR
    delete process.env.OSHIELD_PRIME_AGENT_STATUS_EXTENSION
  }

  function restoreProcessEnv() {
    if (savedProcessPlatform) {
      Object.defineProperty(process, 'platform', savedProcessPlatform)
    }
    if (savedDisableMacosLoginShell !== undefined) {
      process.env.OSHIELD_DISABLE_MACOS_LOGIN_SHELL = savedDisableMacosLoginShell
    } else {
      delete process.env.OSHIELD_DISABLE_MACOS_LOGIN_SHELL
    }
    if (savedShieldUserDataPath !== undefined) {
      process.env.OSHIELD_USER_DATA_PATH = savedShieldUserDataPath
    } else {
      delete process.env.OSHIELD_USER_DATA_PATH
    }
    if (savedOpenCodeConfigDir !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = savedOpenCodeConfigDir
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }
    if (savedShieldOpenCodeConfigDir !== undefined) {
      process.env.OSHIELD_OPENCODE_CONFIG_DIR = savedShieldOpenCodeConfigDir
    } else {
      delete process.env.OSHIELD_OPENCODE_CONFIG_DIR
    }
    if (savedShieldOpenCodeSourceConfigDir !== undefined) {
      process.env.OSHIELD_OPENCODE_SOURCE_CONFIG_DIR = savedShieldOpenCodeSourceConfigDir
    } else {
      delete process.env.OSHIELD_OPENCODE_SOURCE_CONFIG_DIR
    }
    if (savedPiAgentDir !== undefined) {
      process.env.PI_CODING_AGENT_DIR = savedPiAgentDir
    } else {
      delete process.env.PI_CODING_AGENT_DIR
    }
    if (savedShieldPiAgentDir !== undefined) {
      process.env.OSHIELD_PI_CODING_AGENT_DIR = savedShieldPiAgentDir
    } else {
      delete process.env.OSHIELD_PI_CODING_AGENT_DIR
    }
    if (savedShieldPiSourceAgentDir === undefined) {
      delete process.env.OSHIELD_PI_SOURCE_AGENT_DIR
    } else {
      process.env.OSHIELD_PI_SOURCE_AGENT_DIR = savedShieldPiSourceAgentDir
    }
    if (savedShieldCodexHome === undefined) {
      delete process.env.OSHIELD_CODEX_HOME
    } else {
      process.env.OSHIELD_CODEX_HOME = savedShieldCodexHome
    }
    if (savedShieldOmpAgentDir !== undefined) {
      process.env.OSHIELD_OMP_CODING_AGENT_DIR = savedShieldOmpAgentDir
    } else {
      delete process.env.OSHIELD_OMP_CODING_AGENT_DIR
    }
    if (savedShieldOmpSourceAgentDir !== undefined) {
      process.env.OSHIELD_OMP_SOURCE_AGENT_DIR = savedShieldOmpSourceAgentDir
    } else {
      delete process.env.OSHIELD_OMP_SOURCE_AGENT_DIR
    }
    if (savedShieldOmpStatusExtension !== undefined) {
      process.env.OSHIELD_OMP_STATUS_EXTENSION = savedShieldOmpStatusExtension
    } else {
      delete process.env.OSHIELD_OMP_STATUS_EXTENSION
    }
    if (savedPrimeAgentDir !== undefined) {
      process.env.PRIME_AGENT_CODING_AGENT_DIR = savedPrimeAgentDir
    } else {
      delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    }
    if (savedShieldPrimeAgentSourceDir !== undefined) {
      process.env.OSHIELD_PRIME_AGENT_SOURCE_AGENT_DIR = savedShieldPrimeAgentSourceDir
    } else {
      delete process.env.OSHIELD_PRIME_AGENT_SOURCE_AGENT_DIR
    }
    if (savedShieldPrimeAgentStatusExtension !== undefined) {
      process.env.OSHIELD_PRIME_AGENT_STATUS_EXTENSION = savedShieldPrimeAgentStatusExtension
    } else {
      delete process.env.OSHIELD_PRIME_AGENT_STATUS_EXTENSION
    }
    if (savedShieldClaudeAgentStatusSettings === undefined) {
      delete process.env.OSHIELD_CLAUDE_AGENT_STATUS_SETTINGS
    } else {
      process.env.OSHIELD_CLAUDE_AGENT_STATUS_SETTINGS = savedShieldClaudeAgentStatusSettings
    }
  }

  return { applyTestEnvDefaults, restoreProcessEnv }
}
