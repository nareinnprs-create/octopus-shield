import type { EngineId } from './engine-endpoints'
import type { CalderaAssaultAdapter } from './caldera-adapter-contract'
import type { MythicControllerAdapter } from './mythic-adapter-contract'
import type { WazuhManagerAdapter } from './wazuh-adapter-contract'

/** Adapter bundle keyed by engine id so the daemon can compose one implementation per live engine. */
export type EngineAdapterBundle = {
  wazuh: WazuhManagerAdapter
  mythic: MythicControllerAdapter
  caldera: CalderaAssaultAdapter
}

export type EngineAdapterFor<Id extends EngineId> = EngineAdapterBundle[Id]

export type EngineAdapterIdFor<A extends EngineAdapterBundle[keyof EngineAdapterBundle]> = {
  [Key in keyof EngineAdapterBundle]: EngineAdapterBundle[Key] extends A ? Key : never
}[keyof EngineAdapterBundle]
