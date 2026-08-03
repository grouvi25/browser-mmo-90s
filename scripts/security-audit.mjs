import { spawnSync } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const targets = [
  { name: 'backend', cwd: 'backend' },
  { name: 'frontend', cwd: 'frontend' },
]

function audit(cwd) {
  const result = spawnSync(npm, ['audit', '--omit=dev', '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === 'win32',
  })
  if (!result.stdout) {
    throw new Error(`${cwd}: npm audit produced no JSON\n${result.stderr}`)
  }
  return JSON.parse(result.stdout)
}

function isAllowedReactRouterRscFinding(name, finding, vulnerabilities) {
  // The SPA does not use React Router framework/RSC mode. Remove this exception
  // as soon as npm publishes a stable release outside the affected range.
  if (name === 'react-router') {
    const advisories = finding.via.filter(value => typeof value === 'object')
    return advisories.length > 0 && advisories.every(advisory =>
      advisory.url === 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2'
    )
  }
  if (name === 'react-router-dom') {
    return finding.via.every(value => value === 'react-router') &&
      vulnerabilities['react-router'] !== undefined
  }
  return false
}

let failed = false
for (const target of targets) {
  const report = audit(target.cwd)
  const vulnerabilities = report.vulnerabilities ?? {}
  const blocking = Object.entries(vulnerabilities).filter(([name, finding]) => {
    if (!['high', 'critical'].includes(finding.severity)) return false
    if (target.name === 'frontend' && isAllowedReactRouterRscFinding(name, finding, vulnerabilities)) return false
    return true
  })

  const totals = report.metadata?.vulnerabilities ?? {}
  console.log(`${target.name}: ${JSON.stringify(totals)}`)
  if (blocking.length > 0) {
    failed = true
    for (const [name, finding] of blocking) {
      console.error(`BLOCKING ${target.name}: ${name} (${finding.severity}) ${finding.range}`)
    }
  }
}

if (failed) process.exit(1)
console.log('Security audit gate passed: no unapproved high or critical runtime vulnerabilities.')
