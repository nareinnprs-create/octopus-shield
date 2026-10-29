import process from 'node:process'
import { flushObservability, initObservability, shutdownObservability } from '../observability'
import { getOctopodTraceFilePath } from '../observability/logs-directory'

/** Install before runtime startup; close after quit handlers so their spans reach disk. */
export function installOctopodObservability(): () => void {
  initObservability({ traceFilePath: getOctopodTraceFilePath() })
  // Exit handlers flush synchronously even when normal cleanup cannot run.
  process.once('exit', flushObservability)
  return () => {
    process.off('exit', flushObservability)
    void shutdownObservability()
  }
}
