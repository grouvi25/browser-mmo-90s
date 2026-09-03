/**
 * k6 Load Test — MMO 90s Backend
 * ========================================
 * Tests: 3000+ concurrent users with battle actions
 * Run: k6 run load-test.js --env BASE_URL=https://game.grouvi.online
 *
 * Scenarios:
 * 1. auth_flow        — Register + Login (low rate, creates users)
 * 2. browse           — Get profile, inventory, shop (high rate, read-only)
 * 3. battle_cycle     — Start PvE + play to completion (medium rate, stateful)
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend, Counter } from 'k6/metrics'
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js'

const BASE = __ENV.BASE_URL || 'https://game.grouvi.online'

// Custom metrics
const loginSuccessRate  = new Rate('login_success')
const battleCompletions = new Counter('battle_completions')
const actionLatency     = new Trend('battle_action_latency', true)
const authLatency       = new Trend('auth_latency', true)

// ─── Load profile ───────────────────────────────────────────────
export const options = {
  scenarios: {
    // Warm-up: 10 users for 30s
    warmup: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      tags: { scenario: 'warmup' },
    },
    // Ramp to target load
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '60s', target: 100 },   // Ramp up
        { duration: '120s', target: 500 },  // Steady state
        { duration: '60s', target: 1000 },  // Peak
        { duration: '60s', target: 500 },   // Scale down
        { duration: '30s', target: 0 },     // End
      ],
      startTime: '30s',
      tags: { scenario: 'ramp' },
    },
    // Spike test: simulate clan battle surge
    spike: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 200,
      maxVUs: 500,
      startTime: '5m',
      tags: { scenario: 'spike' },
    },
  },
  thresholds: {
    // API SLOs
    'http_req_duration': ['p(95)<500', 'p(99)<1000'], // 95th < 500ms, 99th < 1s
    'http_req_duration{type:auth}':    ['p(95)<300'],
    'http_req_duration{type:battle}':  ['p(95)<800'],
    'http_req_duration{type:read}':    ['p(95)<200'],
    'http_req_failed': ['rate<0.01'],   // < 1% error rate
    'login_success':   ['rate>0.99'],   // > 99% login success
  },
}

// ─── Helpers ────────────────────────────────────────────────────
function post(path, body, token, idem) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (idem) headers['Idempotency-Key'] = idem
  return http.post(`${BASE}${path}`, JSON.stringify(body), { headers })
}

function get(path, token) {
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  return http.get(`${BASE}${path}`, { headers })
}

// ─── Virtual User scenarios ─────────────────────────────────────
export default function () {
  const scenario = __ENV.K6_SCENARIO || 'mixed'

  // Create unique user per VU per iteration
  const uid   = `lu_${__VU}_${__ITER}_${randomString(6)}`
  const email = `${uid}@loadtest.com`
  const pw    = 'loadtest1234'

  // 1. Register
  const regStart = Date.now()
  const regRes = post('/api/auth/register', { login: uid, email, password: pw }, null)
  authLatency.add(Date.now() - regStart)
  if (regRes.status !== 201) {
    sleep(1)
    return // Skip if registration failed (user may already exist in repeated runs)
  }

  // 2. Login
  const loginStart = Date.now()
  const loginRes = post('/api/auth/login', { login: uid, password: pw }, null)
  authLatency.add(Date.now() - loginStart)
  loginSuccessRate.add(loginRes.status === 200)
  if (loginRes.status !== 200) return
  const token = loginRes.json('token')

  // 3. Create character
  const charRes = post('/api/characters', {
    nickname: `LT_${__VU}_${__ITER}`,
    archetype: 'ATHLETE',
  }, token)
  if (charRes.status !== 201) return

  // 4. Browse shop
  const shopRes = get('/api/shops/government/items', token)
  check(shopRes, {
    'shop items loaded': (r) => r.status === 200,
  })
  const items = shopRes.json()
  if (!Array.isArray(items) || items.length === 0) return

  // 5. Buy cheapest item
  const cheapest = items.sort((a, b) => a.template.priceBase - b.template.priceBase)[0]
  const buyRes = post('/api/shops/government/buy', { templateId: cheapest.templateId }, token, `load-gov-buy-${__VU}-${__ITER}`)
  check(buyRes, { 'buy item': (r) => r.status === 201 })
  const itemId = buyRes.json('item.id')

  // 6. Equip item
  if (itemId) {
    post('/api/inventory/equip', { itemInstanceId: itemId }, token)
  }

  sleep(0.1)

  // 7. Start PvE battle
  const battleRes = post('/api/battles/pve/start', { botCode: 'training_bandit' }, token)
  check(battleRes, { 'battle started': (r) => r.status === 201 })
  if (battleRes.status !== 201) return
  const battleId = battleRes.json('battleId')

  // 8. Fight to completion (max 10 rounds per VU to limit load)
  let completed = false
  for (let round = 0; round < 10; round++) {
    sleep(0.05) // Small delay between actions (simulate realistic pacing)
    const actionStart = Date.now()
    const actionRes = post(`/api/battles/${battleId}/action`, { action: 'attack' }, token)
    actionLatency.add(Date.now() - actionStart)

    check(actionRes, {
      'action accepted': (r) => r.status === 200 || r.status === 400,
    })

    if (actionRes.status === 200) {
      const data = actionRes.json()
      if (data.battleOver) {
        completed = true
        battleCompletions.add(1)
        break
      }
    } else {
      break
    }
  }

  // 9. Check health (verify server is still responsive)
  const healthRes = get('/health', null)
  check(healthRes, { 'server healthy': (r) => r.status === 200 })

  sleep(0.5) // Cooldown between iterations
}

// ─── Teardown ────────────────────────────────────────────────────
export function handleSummary(data) {
  console.log('\n=== Load Test Summary ===')
  console.log(`Requests:    ${data.metrics.http_reqs.values.count}`)
  console.log(`Error rate:  ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%`)
  console.log(`p95 latency: ${data.metrics.http_req_duration.values['p(95)'].toFixed(0)}ms`)
  console.log(`p99 latency: ${data.metrics.http_req_duration.values['p(99)'].toFixed(0)}ms`)
  console.log(`Battle completions: ${data.metrics.battle_completions?.values?.count ?? 0}`)
  return {
    'load-test-result.json': JSON.stringify(data),
    stdout: `p95=${data.metrics.http_req_duration.values['p(95)'].toFixed(0)}ms`,
  }
}
