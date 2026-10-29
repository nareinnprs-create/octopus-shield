// Sample plugin runs in a lazily forked plain-Node worker; its default export receives commands, events and capability-gated host API.
export default function activate(shield) {
  shield.commands.register('hello-ping', async (args) => {
    const stored = await shield.host.call('storage.get', { key: 'pings' })
    const count = (typeof stored?.value === 'number' ? stored.value : 0) + 1
    await shield.host.call('storage.set', { key: 'pings', value: count })
    return { pong: true, count, args: args ?? null }
  })

  shield.events.on('worktree.created', async (payload) => {
    shield.log(`worktree created: ${payload.worktreeId} at ${payload.path}`)
    await shield.host.call('notifications.show', {
      title: 'Worktree created',
      body: payload.path
    })
  })

  shield.events.on('agent.status.changed', (payload) => {
    shield.log(`agent status: ${payload.state} in ${payload.worktreeId ?? 'unknown worktree'}`)
  })
}
