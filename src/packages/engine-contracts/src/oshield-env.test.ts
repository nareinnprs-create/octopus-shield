import { describe, expect, it } from 'vitest'

import { ENGINE_ENDPOINTS_DEFAULT, NUCLEUS_INFRA_ENDPOINTS_DEFAULT } from './engine-endpoints'
import {
  ENGINE_ENV_VAR_NAMES,
  engineConfigFromEnv,
  parseEngineEndpointOverrides,
  parseNucleusInfraEndpointOverrides
} from './oshield-env'

describe('parseEngineEndpointOverrides — URL variables', () => {
  it('parses http URLs with an explicit port', () => {
    const overrides = parseEngineEndpointOverrides({
      [ENGINE_ENV_VAR_NAMES.wazuhDashboardUrl]: 'http://10.40.0.10:5601'
    })
    expect(overrides.wazuh?.dashboard).toEqual({ protocol: 'http', host: '10.40.0.10', port: 5601 })
  })

  it('defaults the port from the scheme (https 443, http 80)', () => {
    const overrides = parseEngineEndpointOverrides({
      [ENGINE_ENV_VAR_NAMES.mythicUiUrl]: 'https://mythic.example.internal',
      [ENGINE_ENV_VAR_NAMES.calderaApiUrl]: 'http://caldera.example.internal'
    })
    expect(overrides.mythic?.ui).toEqual({ protocol: 'https', host: 'mythic.example.internal', port: 443 })
    expect(overrides.caldera?.api).toEqual({ protocol: 'http', host: 'caldera.example.internal', port: 80 })
  })

  it('ignores bad values instead of throwing (non-http schemes, unparseable, empty)', () => {
    const overrides = parseEngineEndpointOverrides({
      [ENGINE_ENV_VAR_NAMES.wazuhManagerApiUrl]: 'ftp://wazuh.example.internal',
      [ENGINE_ENV_VAR_NAMES.mythicUiUrl]: 'not a url at all',
      [ENGINE_ENV_VAR_NAMES.calderaUiUrl]: ''
    })
    expect(overrides.wazuh?.managerApi).toBeUndefined()
    expect(overrides.mythic?.ui).toBeUndefined()
    expect(overrides.caldera?.ui).toBeUndefined()
  })

  it('returns an all-undefined override shape for an empty env', () => {
    const overrides = parseEngineEndpointOverrides({})
    expect(overrides).toEqual({
      wazuh: { dashboard: undefined, managerApi: undefined, agentTcpPort: undefined, agentEnrollmentPort: undefined },
      mythic: { ui: undefined, postgres: undefined, rabbitmq: undefined },
      caldera: { ui: undefined, api: undefined }
    })
  })
})

describe('parseEngineEndpointOverrides — port bounds 1..65535', () => {
  const portCases: readonly [string, number | undefined][] = [
    ['1', 1],
    ['1514', 1514],
    ['65535', 65535],
    ['0', undefined],
    ['-1', undefined],
    ['65536', undefined],
    ['1514.5', undefined],
    ['abc', undefined],
    ['', undefined]
  ]
  for (const [raw, expected] of portCases) {
    it(`agentTcpPort ${JSON.stringify(raw)} -> ${String(expected)}`, () => {
      const overrides = parseEngineEndpointOverrides({ [ENGINE_ENV_VAR_NAMES.wazuhAgentTcpPort]: raw })
      expect(overrides.wazuh?.agentTcpPort).toBe(expected)
    })
  }
})

describe('parseEngineEndpointOverrides — host:port pairs (SAFE_HOST charset)', () => {
  it('accepts localhost, IPv4 literal, and FQDN hosts', () => {
    const overrides = parseEngineEndpointOverrides({
      [ENGINE_ENV_VAR_NAMES.mythicPostgresHost]: '127.0.0.1',
      [ENGINE_ENV_VAR_NAMES.mythicPostgresPort]: '5436',
      [ENGINE_ENV_VAR_NAMES.mythicRabbitmqHost]: 'rabbit.mq.internal.example'
    })
    expect(overrides.mythic?.postgres).toEqual({ host: '127.0.0.1', port: 5436 })
    expect(overrides.mythic?.rabbitmq).toEqual({ host: 'rabbit.mq.internal.example', port: undefined })
  })

  it('accepts the full SAFE_HOST charset [A-Za-z0-9._-]', () => {
    const overrides = parseNucleusInfraEndpointOverrides({
      [ENGINE_ENV_VAR_NAMES.nucleusRedisHost]: 'Redis_01.node-x',
      [ENGINE_ENV_VAR_NAMES.nucleusRedisPort]: '6381'
    })
    expect(overrides.redis).toEqual({ host: 'Redis_01.node-x', port: 6381 })
  })

  it('rejects path, userinfo, and space smuggling in the host; the port still parses', () => {
    const overrides = parseEngineEndpointOverrides({
      [ENGINE_ENV_VAR_NAMES.mythicPostgresHost]: 'host.example/path',
      [ENGINE_ENV_VAR_NAMES.mythicPostgresPort]: '5432',
      [ENGINE_ENV_VAR_NAMES.mythicRabbitmqHost]: 'user@rabbit.internal'
    })
    expect(overrides.mythic?.postgres).toEqual({ host: undefined, port: 5432 })
    expect(overrides.mythic?.rabbitmq).toBeUndefined()
  })

  it('rejects hosts with spaces', () => {
    const overrides = parseNucleusInfraEndpointOverrides({
      [ENGINE_ENV_VAR_NAMES.nucleusNatsClientHost]: 'nats host',
      [ENGINE_ENV_VAR_NAMES.nucleusNatsClientPort]: '4222'
    })
    expect(overrides.natsClient).toEqual({ host: undefined, port: 4222 })
  })

  it('returns undefined when neither host nor port is usable', () => {
    const overrides = parseNucleusInfraEndpointOverrides({
      [ENGINE_ENV_VAR_NAMES.nucleusPostgresHost]: 'bad host',
      [ENGINE_ENV_VAR_NAMES.nucleusPostgresPort]: '0'
    })
    expect(overrides.postgresPgvector).toBeUndefined()
  })
})

describe('parseNucleusInfraEndpointOverrides — nats monitor precedence', () => {
  it('the URL variable wins over the host/port pair', () => {
    const overrides = parseNucleusInfraEndpointOverrides({
      [ENGINE_ENV_VAR_NAMES.nucleusNatsMonitorUrl]: 'http://10.9.9.1:8222',
      [ENGINE_ENV_VAR_NAMES.nucleusNatsMonitorHost]: 'ignored.internal',
      [ENGINE_ENV_VAR_NAMES.nucleusNatsMonitorPort]: '1'
    })
    expect(overrides.natsMonitor).toEqual({ protocol: 'http', host: '10.9.9.1', port: 8222 })
  })

  it('falls back to the host/port pair without a protocol', () => {
    const overrides = parseNucleusInfraEndpointOverrides({
      [ENGINE_ENV_VAR_NAMES.nucleusNatsMonitorHost]: 'monitor.internal',
      [ENGINE_ENV_VAR_NAMES.nucleusNatsMonitorPort]: '8222'
    })
    expect(overrides.natsMonitor).toEqual({ host: 'monitor.internal', port: 8222 })
  })

  it('an unparseable URL falls through to the host/port pair', () => {
    const overrides = parseNucleusInfraEndpointOverrides({
      [ENGINE_ENV_VAR_NAMES.nucleusNatsMonitorUrl]: 'gopher://monitor.internal',
      [ENGINE_ENV_VAR_NAMES.nucleusNatsMonitorHost]: 'monitor.internal',
      [ENGINE_ENV_VAR_NAMES.nucleusNatsMonitorPort]: '8222'
    })
    expect(overrides.natsMonitor).toEqual({ host: 'monitor.internal', port: 8222 })
  })
})

describe('engineConfigFromEnv', () => {
  it('resolves the documented defaults from an empty env', () => {
    const config = engineConfigFromEnv({})
    expect(config.engines).toEqual(ENGINE_ENDPOINTS_DEFAULT)
    expect(config.nucleus).toEqual(NUCLEUS_INFRA_ENDPOINTS_DEFAULT)
    expect(config.engines.caldera.api).toEqual({ protocol: 'http', host: 'localhost', port: 8890 })
    expect(config.engines.wazuh.managerApi).toEqual({ protocol: 'https', host: 'localhost', port: 55000 })
    expect(config.nucleus.natsClient).toEqual({ host: 'localhost', port: 4222 })
  })

  it('merges sparse overrides onto the defaults', () => {
    const config = engineConfigFromEnv({
      [ENGINE_ENV_VAR_NAMES.calderaApiUrl]: 'https://caldera.example.internal:8443',
      [ENGINE_ENV_VAR_NAMES.wazuhAgentTcpPort]: '2514',
      [ENGINE_ENV_VAR_NAMES.nucleusRedisHost]: 'redis.internal',
      [ENGINE_ENV_VAR_NAMES.nucleusRedisPort]: '6399'
    })
    expect(config.engines.caldera.api).toEqual({ protocol: 'https', host: 'caldera.example.internal', port: 8443 })
    expect(config.engines.caldera.ui).toEqual(ENGINE_ENDPOINTS_DEFAULT.caldera.ui)
    expect(config.engines.wazuh.agentTcpPort).toBe(2514)
    expect(config.engines.wazuh.dashboard).toEqual(ENGINE_ENDPOINTS_DEFAULT.wazuh.dashboard)
    expect(config.nucleus.redis).toEqual({ host: 'redis.internal', port: 6399 })
  })

  it('bad override values never move an endpoint off its default', () => {
    const config = engineConfigFromEnv({
      [ENGINE_ENV_VAR_NAMES.wazuhDashboardUrl]: 'ftp://nope',
      [ENGINE_ENV_VAR_NAMES.wazuhAgentEnrollmentPort]: '99999'
    })
    expect(config.engines.wazuh.dashboard).toEqual(ENGINE_ENDPOINTS_DEFAULT.wazuh.dashboard)
    expect(config.engines.wazuh.agentEnrollmentPort).toBe(ENGINE_ENDPOINTS_DEFAULT.wazuh.agentEnrollmentPort)
  })
})
