import type {
  NeuroSessionSpawnOutcome,
  NeuroSessionSpawnRequest,
  NeuroSessionsSnapshot
} from '../../shared/neuro-sessions-contract'

export type NeuroSessionsApi = {
  list: () => Promise<NeuroSessionsSnapshot>
  spawn: (request: NeuroSessionSpawnRequest) => Promise<NeuroSessionSpawnOutcome>
  stop: (taskId: string) => Promise<boolean>
  retry: (taskId: string) => Promise<NeuroSessionSpawnOutcome>
}
