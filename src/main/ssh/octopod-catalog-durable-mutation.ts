import type { OctopodMigrationCatalogState } from '../../shared/octopod-migration/octopod-migration-manifest'

export async function resolveDurableOctopodCatalogMutation(
  mutate: () => Promise<OctopodMigrationCatalogState>,
  read: () => Promise<OctopodMigrationCatalogState>,
  accepted: (state: OctopodMigrationCatalogState) => boolean
) {
  try {
    return await mutate()
  } catch (mutationError) {
    let observed: OctopodMigrationCatalogState
    try {
      observed = await read()
    } catch {
      throw mutationError
    }
    if (!accepted(observed)) {
      throw mutationError
    }
  }
  // State reads may reflect unflushed mutations; an idempotent acknowledgment proves durability.
  return mutate()
}
