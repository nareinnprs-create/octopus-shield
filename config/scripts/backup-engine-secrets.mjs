import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const REPO = process.cwd()
const STAMP = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
const OUT = join(process.env.OSH_BACKUP_ROOT ?? 'C:\\Users\\manag\\tools\\osh-backups', STAMP)

/** Secret/config material only — never multi-GB data dirs, never node_modules. */
const TARGETS = [
  ['engines/wazuh-docker/single-node/config', 'wazuh/config'],
  ['engines/wazuh-docker/single-node/config/credentials', 'wazuh/credentials'],
  ['engines/mythic/nginx-docker/ssl', 'mythic/nginx-ssl'],
  ['engines/mythic/nginx-docker/config', 'mythic/nginx-config'],
  ['engines/mythic/rabbitmq-docker/rabbitmq.conf', 'mythic/rabbitmq.conf'],
  ['engines/mythic/rabbitmq-docker/generate_config.sh', 'mythic/generate_config.sh'],
  ['engines/mythic/postgres-docker/postgres.conf', 'mythic/postgres.conf'],
  ['engines/mythic/mythic-docker/src/.env', 'mythic/mythic-src.env'],
  ['engines/mythic/mythic-react-docker/config', 'mythic/react-config'],
  ['engines/mythic/hasura-docker/metadata', 'mythic/hasura-metadata'],
  ['engines/caldera/conf/local.yml', 'caldera/local.yml'],
  ['infra/.pg_password', 'infra/.pg_password'],
  ['infra/.nats_token', 'infra/.nats_token'],
  ['infra/.env', 'infra/.env'],
  ['infra/db/audit.sql', 'infra/db/audit.sql'],
  ['infra/db/rbac.sql', 'infra/db/rbac.sql']
]

const EXTERNAL = [
  ['C:\\Users\\manag\\tools\\armory\\bloodhound\\docker-compose.yml', 'bloodhound/docker-compose.yml'],
  ['C:\\Users\\manag\\tools\\armory\\bloodhound\\initial-admin-password.txt', 'bloodhound/initial-admin-password.txt'],
  ['C:\\Users\\manag\\tools\\armory\\inventory', 'armory-inventory'],
  ['C:\\Users\\manag\\tools\\armory\\credentials', 'armory-credentials']
]

let copied = 0
let missing = []

function copyAbsolute(src, relOut) {
  const target = join(OUT, relOut)
  if (!existsSync(src)) {
    missing.push(relOut)
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  cpSync(src, target, { recursive: true, force: true, filter: (s) => !s.includes('node_modules') && !s.includes('.git' + sep()) })
  copied += statSync(target).isDirectory() ? countFiles(target) : 1
}

function sep() {
  return process.platform === 'win32' ? '\\' : '/'
}

function countFiles(dir) {
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    n += e.isDirectory() ? countFiles(p) : 1
  }
  return n
}

mkdirSync(OUT, { recursive: true })
for (const [rel, outRel] of TARGETS) copyAbsolute(join(REPO, rel), outRel)
for (const [src, outRel] of EXTERNAL) copyAbsolute(src, outRel)

writeFileSync(join(OUT, 'MANIFEST.txt'), `Octopus Shield secrets backup ${STAMP}\ncopied files: ${copied}\nmissing paths:\n${missing.join('\n')}\n`)
console.log(`backup: ${OUT}`)
console.log(`copied: ${copied} files; missing: ${missing.length}`)
if (missing.length > 0) process.exitCode = 1
