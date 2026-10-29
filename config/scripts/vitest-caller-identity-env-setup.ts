// Clear structured chat’s inherited orchestration identity so test branches depend on fixture env, not which agent launched runner.
for (const name of ['OSHIELD_AGENT_SESSION_ID', 'OSHIELD_STRUCTURED_SESSION']) {
  delete process.env[name]
}
