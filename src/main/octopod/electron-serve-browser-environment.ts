/** Strip octopod-owned user-data and browser overrides from the helper environment. */
export function electronServeEnvironment(userDataPath: string): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  for (const key of [
    'OSHIELD_E2E_USER_DATA_DIR',
    'OSHIELD_USER_DATA',
    'OSHIELD_USER_DATA_PATH',
    'AGENT_BROWSER_ARGS',
    'AGENT_BROWSER_AUTO_CONNECT',
    'AGENT_BROWSER_CDP',
    'AGENT_BROWSER_ENGINE',
    'AGENT_BROWSER_EXECUTABLE_PATH',
    'AGENT_BROWSER_HEADED',
    'AGENT_BROWSER_PROFILE',
    'AGENT_BROWSER_PROVIDER',
    'AGENT_BROWSER_SESSION',
    'AGENT_BROWSER_SESSION_NAME',
    'AGENT_BROWSER_STATE'
  ]) {
    delete environment[key]
  }
  // Keep Electron's native home override active in isolated sidecars.
  if (process.env.OSHIELD_E2E_USER_DATA_DIR || process.env.OSHIELD_E2E_HOME_DIR) {
    environment.OSHIELD_E2E_USER_DATA_DIR = userDataPath
  }
  // Older installed apps hide without forwarding opens if given OSHIELD_BACKGROUND_LAUNCH.
  environment.OSHIELD_OCTOPOD_SIDECAR = '1'
  return environment
}
