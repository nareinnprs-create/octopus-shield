import { RuntimeClientError } from '../../runtime-client'

export function resolveCompatibilityCliCommand(): 'shield' | 'shield-ide' | 'shield-dev' {
  const configured = process.env.OSHIELD_CLI_COMMAND
  if (configured === 'shield' || configured === 'shield-ide' || configured === 'shield-dev') {
    return configured
  }
  return process.platform === 'linux' ? 'shield-ide' : 'shield'
}

export function resolvePackagedWindowsCompatibilityCommand(): 'shield' | 'shield-ide' | undefined {
  if (process.env.OSHIELD_WINDOWS_PACKAGED_CLI_LAUNCHER !== '1') {
    return undefined
  }
  const command = process.env.OSHIELD_CLI_COMMAND
  if (command === 'shield' || command === 'shield-ide') {
    return command
  }
  throw new RuntimeClientError(
    'invalid_argument',
    'The packaged Shield launcher did not provide a valid resume command. No question was created.'
  )
}

export async function flushOrchestrationStdout(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write('', (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function isDevCliInvocation(): boolean {
  return (
    process.env.OSHIELD_DEV_CLI_INVOCATION === '1' ||
    (process.env.OSHIELD_USER_DATA_PATH?.includes('shield-dev') ?? false)
  )
}
