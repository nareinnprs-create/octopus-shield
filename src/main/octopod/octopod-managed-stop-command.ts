// Exit 0 means JSON was printed; read its outcome. Exit 64 is invalid input, 1 is failure without exit proof.
import {
  OCTOPOD_CANCEL_MANAGED_STOP_FLAG,
  OCTOPOD_COMPLETE_MANAGED_STOP_FLAG,
  OCTOPOD_MANAGED_STOP_REQUEST_FILE_FLAG,
  OctopodManagedStopRequestSchema,
  type OctopodManagedStopCancellation,
  type OctopodManagedStopCompletion,
  type OctopodManagedStopRequest
} from '../../shared/octopod-stop-request'
import { cancelOctopodManagedStop } from './octopod-managed-stop-cancellation'
import { readOctopodCompletedStopReceipt } from './octopod-completed-stop-receipt'
import { readOctopodManagedStopRequest } from './octopod-managed-stop-request'
import { ZodError } from 'zod'
import {
  completeOctopodManagedStop,
  type OctopodManagedStopCompletionOptions
} from './octopod-managed-stop-completion'

export async function runOctopodManagedStopCommand(
  argv: readonly string[],
  options: OctopodManagedStopCompletionOptions = {}
): Promise<OctopodManagedStopCompletion> {
  const request = parseRequestArgument(argv, OCTOPOD_COMPLETE_MANAGED_STOP_FLAG)
  const verdict = await completeOctopodManagedStop(request, options)
  const retirement =
    verdict === 'exited' && request.retireIdleDaemon
      ? readOctopodCompletedStopReceipt(request)?.retirement
      : undefined
  const completion: OctopodManagedStopCompletion = {
    ...request,
    kind: 'octopod_managed_stop_completion',
    verdict,
    receiptPersisted: verdict === 'exited',
    ...(retirement ? { retirement } : {})
  }
  process.stdout.write(`${JSON.stringify(completion)}\n`)
  return completion
}

export function runOctopodManagedStopCancelCommand(
  argv: readonly string[]
): OctopodManagedStopCancellation {
  const request = parseRequestArgument(argv, OCTOPOD_CANCEL_MANAGED_STOP_FLAG)
  const cancellation: OctopodManagedStopCancellation = {
    ...request,
    kind: 'octopod_managed_stop_cancellation',
    outcome: cancelOctopodManagedStop(request)
  }
  process.stdout.write(`${JSON.stringify(cancellation)}\n`)
  return cancellation
}

function parseRequestArgument(argv: readonly string[], flag: string): OctopodManagedStopRequest {
  if (argv[0] !== flag) {
    throw new Error('octopod_managed_stop_invalid_arguments')
  }
  if (argv[1] === OCTOPOD_MANAGED_STOP_REQUEST_FILE_FLAG) {
    if (argv.length !== 3 || !argv[2]) {
      throw new Error('octopod_managed_stop_invalid_arguments')
    }
    return readOctopodManagedStopRequest(argv[2])
  }
  if (argv.length !== 2 || !argv[1]) {
    throw new Error('octopod_managed_stop_invalid_arguments')
  }
  return OctopodManagedStopRequestSchema.parse(JSON.parse(argv[1]))
}

export const OCTOPOD_MANAGED_STOP_EXIT_VERDICT = 0
export const OCTOPOD_MANAGED_STOP_EXIT_FAILED = 1
export const OCTOPOD_MANAGED_STOP_EXIT_USAGE = 64

export async function runOctopodManagedStopCommandAndExit(argv: readonly string[]): Promise<void> {
  let code = OCTOPOD_MANAGED_STOP_EXIT_VERDICT
  try {
    if (argv[0] === OCTOPOD_CANCEL_MANAGED_STOP_FLAG) {
      runOctopodManagedStopCancelCommand(argv)
    } else {
      await runOctopodManagedStopCommand(argv)
    }
  } catch (error) {
    console.error('octopod: managed stop failed:', error)
    code =
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === 'octopod_managed_stop_invalid_arguments')
        ? OCTOPOD_MANAGED_STOP_EXIT_USAGE
        : OCTOPOD_MANAGED_STOP_EXIT_FAILED
  }
  // Drain stdout before exit: callers read the result to EOF.
  process.stdout.write('', () => process.exit(code))
}
