/**
 * Bugfix Endpoints
 *
 * AI-assisted bugfix workflow: scan error logs, trigger GitHub Actions,
 * track fix status, deploy fixes.
 *
 * Endpoints:
 *   GET  /kscw/bugfixes/issues         — scan last 7 days of error logs (superuser)
 *   POST /kscw/bugfixes/fix            — trigger AI bugfix workflow (superuser)
 *   GET  /kscw/bugfixes/status/:hash   — check fix status + PR detection (superuser)
 *   POST /kscw/bugfixes/deploy/:hash   — merge PR / deploy to prod (superuser)
 *   POST /kscw/bugfixes/dismiss/:hash  — dismiss error as solved (superuser)
 *   GET  /kscw/bugfixes/public         — public fix summaries (auth)
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { computeErrorHash } from './error-log.js'

/**
 * May this log entry feed the AI-fix pipeline? Server-side entries (no `source`,
 * or anything but 'frontend') always; a FRONTEND report only when it carried an
 * authenticated user. `/kscw/client-error` and the CSP report route are
 * anonymous, so an unauthenticated entry is attacker-written text — it may be
 * logged, but it must never become an LLM prompt that opens a PR (2026-09-28
 * audit). Pure; exported for the unit test.
 */
export function isAiFixEligible(entry) {
  if (!entry || typeof entry !== 'object') return false
  if (entry.source !== 'frontend') return true
  return typeof entry.userId === 'string' && entry.userId.length > 0
}

/** Constant-time bearer comparison (length checked first — timingSafeEqual throws on a mismatch). */
function safeTokenEqual(given, expected) {
  if (!expected || typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const ERROR_LOG_DIR = process.env.ERROR_LOG_DIR || '/directus/logs'
const GITHUB_PAT = process.env.GITHUB_PAT
const REPO_OWNER = 'Lucanepa'
const ALLOWED_REPOS = ['wiedisync', 'kscw-website']
const DEFAULT_REPO = 'wiedisync'
const MAX_CONCURRENT_FIXES = 3
const HASH_REGEX = /^[a-zA-Z0-9_-]{1,64}$/
const MAX_CONTEXT_BYTES = 50 * 1024 // 50 KB

// ── Sanitization patterns ────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /token["\s:=]+[A-Za-z0-9._~+/=-]{10,}/gi,
  /password["\s:=]+[^\s,}"]+/gi,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, // JWT
]

function sanitizeString(str) {
  if (!str || typeof str !== 'string') return str
  let result = str
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

const SENSITIVE_KEYS = /^(password|token|secret|auth|bearer|cookie|session|otp|refresh_token|access_token|api_key|apikey|credential)$/i

function scrubSensitiveKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(scrubSensitiveKeys)
  const safe = {}
  for (const [k, v] of Object.entries(obj)) {
    safe[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : scrubSensitiveKeys(v)
  }
  return safe
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return sanitizeString(obj)
  if (Array.isArray(obj)) return obj.map(sanitizeObject)
  const safe = {}
  for (const [k, v] of Object.entries(obj)) {
    safe[k] = sanitizeObject(v)
  }
  return safe
}

// ── JSONL reading helper ─────────────────────────────────────────

function readErrorLogForDate(date) {
  const logPath = path.join(ERROR_LOG_DIR, `errors-${date}.jsonl`)
  if (!fs.existsSync(logPath)) return []
  try {
    const raw = fs.readFileSync(logPath, 'utf-8')
    return raw.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

// ── GitHub API helper ────────────────────────────────────────────

async function githubApi(endpoint, options = {}, repo = DEFAULT_REPO) {
  const url = endpoint.startsWith('https://')
    ? endpoint
    : `https://api.github.com/repos/${REPO_OWNER}/${repo}${endpoint}`
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `token ${GITHUB_PAT}`,
      Accept: 'application/vnd.github.v3+json',
      ...options.headers,
    },
  })
  return resp
}

export function registerBugfixes(router, ctx) {
  const { database, logger } = ctx
  const log = logger.child({ extension: 'kscw-bugfixes' })

  // ── Auth helpers (closure over database + log) ───────────────

  function requireAuth(req) {
    if (!req.accountability?.user) {
      const err = new Error('Authentication required')
      err.status = 401
      throw err
    }
  }

  async function requireSuperuser(req) {
    requireAuth(req)
    const row = await database('directus_users')
      .join('directus_roles', 'directus_users.role', 'directus_roles.id')
      .where('directus_users.id', req.accountability.user)
      .select('directus_roles.name as role_name')
      .first()
    if (!row || row.role_name !== 'Superuser') {
      log.warn({ msg: 'Superuser access denied', userId: req.accountability.user })
      const err = new Error('Superuser access required')
      err.status = 403
      throw err
    }
  }

  // ── GET /bugfixes/issues ─────────────────────────────────────
  // Scan last 7 days of JSONL logs, deduplicate by hash, merge with
  // bugfix_jobs and error_annotations.

  router.get('/bugfixes/issues', async (req, res) => {
    try {
      await requireSuperuser(req)

      // Collect entries from last 7 days
      const allEntries = []
      for (let i = 0; i < 7; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().slice(0, 10)
        const entries = readErrorLogForDate(dateStr)
        for (const entry of entries) {
          entry._date = dateStr
          entry._hash = computeErrorHash(entry)
          allEntries.push(entry)
        }
      }
      const eligibleHashes = new Set()
      for (const entry of allEntries) {
        if (isAiFixEligible(entry)) eligibleHashes.add(entry._hash)
      }

      // Deduplicate by hash — keep latest occurrence, sum counts
      const deduped = new Map()
      for (const entry of allEntries) {
        const existing = deduped.get(entry._hash)
        if (existing) {
          existing._count = (existing._count || 1) + 1
          // Keep the latest entry (by timestamp)
          if (entry.ts > existing.ts) {
            const count = existing._count
            deduped.set(entry._hash, { ...entry, _count: count })
          }
        } else {
          deduped.set(entry._hash, { ...entry, _count: 1 })
        }
      }

      const uniqueHashes = [...deduped.keys()]

      // Left-join bugfix_jobs
      const jobs = uniqueHashes.length
        ? await database('bugfix_jobs').whereIn('error_hash', uniqueHashes)
        : []
      const jobMap = Object.fromEntries(jobs.map(j => [j.error_hash, j]))

      // Left-join error_annotations
      const annotations = uniqueHashes.length
        ? await database('error_annotations').whereIn('error_hash', uniqueHashes)
        : []
      const annoMap = Object.fromEntries(annotations.map(a => [a.error_hash, a]))

      // Merge and return
      const issues = [...deduped.values()].map(entry => ({
        hash: entry._hash,
        count: entry._count,
        latest_ts: entry.ts,
        date: entry._date,
        level: entry.level,
        event: entry.event,
        endpoint: entry.endpoint || null,
        error: entry.error || null,
        stack: entry.stack || null,
        breadcrumbs: entry.breadcrumbs || null,
        page: entry.page || null,
        userAgent: entry.userAgent || null,
        status: entry.status || null,
        collection: entry.collection || null,
        responseBody: entry.responseBody || null,
        // False → every occurrence was an anonymous client report; POST /fix refuses it.
        ai_fix_eligible: eligibleHashes.has(entry._hash),
        // Merged data
        job: jobMap[entry._hash] ? {
          status: jobMap[entry._hash].status,
          pr_number: jobMap[entry._hash].pr_number,
          pr_url: jobMap[entry._hash].pr_url,
          fix_summary: jobMap[entry._hash].fix_summary,
          public_summary: jobMap[entry._hash].public_summary,
          date_created: jobMap[entry._hash].date_created,
        } : null,
        annotation: annoMap[entry._hash] ? {
          status: annoMap[entry._hash].status,
          note: annoMap[entry._hash].note,
          resolved_commit: annoMap[entry._hash].resolved_commit,
        } : null,
      }))

      // Sort by count descending (most frequent first)
      issues.sort((a, b) => b.count - a.count)

      res.json({ data: issues, total: issues.length })
    } catch (err) {
      log.error({ msg: 'bugfixes/issues error', error: err.message })
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  // ── POST /bugfixes/fix ───────────────────────────────────────
  // Trigger AI bugfix workflow for a specific error hash.

  router.post('/bugfixes/fix', async (req, res) => {
    try {
      await requireSuperuser(req)

      const { error_hash, repo: reqRepo } = req.body
      const repo = reqRepo || DEFAULT_REPO
      if (!error_hash || !HASH_REGEX.test(error_hash)) {
        return res.status(400).json({ error: 'Invalid error_hash' })
      }
      if (!ALLOWED_REPOS.includes(repo)) {
        return res.status(400).json({ error: `Invalid repo. Allowed: ${ALLOWED_REPOS.join(', ')}` })
      }

      if (!GITHUB_PAT) {
        return res.status(500).json({ error: 'GITHUB_PAT not configured' })
      }

      // Find error details from JSONL logs (before transaction, read-only)
      // Only an ELIGIBLE occurrence (isAiFixEligible) may become the prompt — the
      // hash ignores userId, so an anonymous twin of a real error must not be the
      // one whose free text is sent.
      let errorEntry = null
      let errorDate = null
      let sawIneligible = false
      for (let i = 0; i < 7; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().slice(0, 10)
        const entries = readErrorLogForDate(dateStr)
        for (const entry of entries) {
          if (computeErrorHash(entry) === error_hash) {
            if (!isAiFixEligible(entry)) { sawIneligible = true; continue }
            errorEntry = entry
            errorDate = dateStr
            break
          }
        }
        if (errorEntry) break
      }

      if (!errorEntry) {
        if (sawIneligible) {
          return res.status(422).json({
            error: 'Only anonymous client reports of this error exist — not eligible for an AI fix',
            code: 'unauthenticated_source',
          })
        }
        return res.status(404).json({ error: 'Error not found in recent logs' })
      }

      // Atomic check-and-insert inside a transaction to prevent TOCTOU race
      const txResult = await database.transaction(async (trx) => {
        // Check concurrent fix limit
        const activeJobs = await trx('bugfix_jobs')
          .whereIn('status', ['fixing', 'pr_ready'])
          .count('* as count')
          .first()
        if (activeJobs && parseInt(activeJobs.count) >= MAX_CONCURRENT_FIXES) {
          return { error: 'rate_limit' }
        }

        // Check if already being fixed
        const existingJob = await trx('bugfix_jobs')
          .where('error_hash', error_hash)
          .whereIn('status', ['fixing', 'pr_ready'])
          .first()
        if (existingJob) {
          return { error: 'conflict', status: existingJob.status, pr_url: existingJob.pr_url }
        }

        // Insert job row
        const now = new Date().toISOString()
        await trx('bugfix_jobs').insert({
          error_hash,
          repo,
          error_date: errorDate,
          status: 'fixing',
          triggered_by: req.accountability.user,
          date_created: now,
          date_updated: now,
        }).onConflict('error_hash').merge({
          status: 'fixing',
          repo,
          error_date: errorDate,
          triggered_by: req.accountability.user,
          date_updated: now,
          pr_number: null,
          pr_url: null,
          fix_summary: null,
          public_summary: null,
          merge_sha: null,
        })

        return { ok: true }
      })

      if (txResult.error === 'rate_limit') {
        return res.status(429).json({
          error: `Maximum ${MAX_CONCURRENT_FIXES} concurrent fixes allowed`,
        })
      }
      if (txResult.error === 'conflict') {
        return res.status(409).json({
          error: 'Fix already in progress or ready',
          status: txResult.status,
          pr_url: txResult.pr_url,
        })
      }

      // Build sanitized context — scrub both values (regex) and keys (name-based)
      let context = sanitizeObject({
        error: errorEntry.error,
        stack: errorEntry.stack,
        event: errorEntry.event,
        endpoint: errorEntry.endpoint,
        level: errorEntry.level,
        status: errorEntry.status,
        collection: errorEntry.collection,
        page: errorEntry.page,
        userAgent: errorEntry.userAgent,
        breadcrumbs: errorEntry.breadcrumbs,
        responseBody: errorEntry.responseBody,
        method: errorEntry.method,
        body: scrubSensitiveKeys(errorEntry.body),
        params: scrubSensitiveKeys(errorEntry.params),
      })

      // Truncate breadcrumbs beyond 20
      if (Array.isArray(context.breadcrumbs) && context.breadcrumbs.length > 20) {
        context.breadcrumbs = context.breadcrumbs.slice(-20)
      }

      // Remove null/undefined fields
      context = Object.fromEntries(
        Object.entries(context).filter(([, v]) => v != null)
      )

      // Truncate to 50KB
      let contextStr = JSON.stringify(context)
      if (contextStr.length > MAX_CONTEXT_BYTES) {
        // Drop breadcrumbs first
        delete context.breadcrumbs
        contextStr = JSON.stringify(context)
      }
      if (contextStr.length > MAX_CONTEXT_BYTES) {
        // Trim stack
        if (context.stack) {
          const lines = context.stack.split('\n')
          context.stack = lines.slice(0, 10).join('\n') + '\n... (truncated)'
          contextStr = JSON.stringify(context)
        }
      }
      if (contextStr.length > MAX_CONTEXT_BYTES) {
        contextStr = contextStr.slice(0, MAX_CONTEXT_BYTES)
      }

      // Trigger GitHub Actions workflow on the target repo
      const resp = await githubApi(
        '/actions/workflows/bugfix-ai.yml/dispatches',
        {
          method: 'POST',
          body: JSON.stringify({
            ref: 'dev',
            inputs: { error_hash, error_context: contextStr },
          }),
        },
        repo
      )

      if (resp.status !== 204) {
        const body = await resp.text()
        log.error({ msg: 'GitHub dispatch failed', status: resp.status, body })
        // Roll back job status
        await database('bugfix_jobs')
          .where('error_hash', error_hash)
          .update({ status: 'failed', date_updated: new Date().toISOString() })
        return res.status(502).json({ error: 'Failed to trigger GitHub workflow' })
      }

      log.info({ msg: 'Bugfix workflow triggered', error_hash })
      res.json({ success: true, error_hash, status: 'fixing' })
    } catch (err) {
      log.error({ msg: 'bugfixes/fix error', error: err.message })
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  // ── GET /bugfixes/status/:hash ───────────────────────────────
  // Check fix status. If "fixing", poll GitHub for PR.

  router.get('/bugfixes/status/:hash', async (req, res) => {
    try {
      await requireSuperuser(req)

      const { hash } = req.params
      if (!HASH_REGEX.test(hash)) {
        return res.status(400).json({ error: 'Invalid hash' })
      }

      const job = await database('bugfix_jobs').where('error_hash', hash).first()
      if (!job) {
        return res.status(404).json({ error: 'No bugfix job found for this hash' })
      }

      // If currently fixing, check for PR
      const jobRepo = job.repo || DEFAULT_REPO
      if (!ALLOWED_REPOS.includes(jobRepo)) {
        return res.status(500).json({ error: 'Invalid repo in job record' })
      }
      if (job.status === 'fixing' && GITHUB_PAT) {
        try {
          const prResp = await githubApi(
            `/pulls?head=${REPO_OWNER}:bugfix/${hash}&state=open`,
            {},
            jobRepo
          )
          if (prResp.ok) {
            const prs = await prResp.json()
            if (prs.length > 0) {
              const pr = prs[0]
              const body = pr.body || ''

              // Parse fix_summary and public_summary from PR body
              let fixSummary = null
              let publicSummary = null
              for (const line of body.split('\n')) {
                if (line.startsWith('fix_summary:')) {
                  fixSummary = line.slice('fix_summary:'.length).trim()
                } else if (line.startsWith('public_summary:')) {
                  publicSummary = line.slice('public_summary:'.length).trim()
                }
              }

              await database('bugfix_jobs')
                .where('error_hash', hash)
                .update({
                  status: 'pr_ready',
                  pr_number: pr.number,
                  pr_url: pr.html_url,
                  fix_summary: fixSummary,
                  public_summary: publicSummary,
                  date_updated: new Date().toISOString(),
                })

              const updated = await database('bugfix_jobs').where('error_hash', hash).first()
              return res.json({ data: updated })
            }
          }

          // Check if workflow might have failed (no PR after 2 min)
          const ageMs = Date.now() - new Date(job.date_created).getTime()
          if (ageMs > 2 * 60 * 1000) {
            // Check workflow runs for failure
            const runsResp = await githubApi(
              `/actions/workflows/bugfix-ai.yml/runs?per_page=5`,
              {},
              jobRepo
            )
            if (runsResp.ok) {
              const runs = await runsResp.json()
              const failedRun = runs.workflow_runs?.find(
                r => r.status === 'completed' && r.conclusion === 'failure'
                  && new Date(r.created_at) >= new Date(job.date_created)
              )
              if (failedRun) {
                await database('bugfix_jobs')
                  .where('error_hash', hash)
                  .update({ status: 'failed', date_updated: new Date().toISOString() })
                const updated = await database('bugfix_jobs').where('error_hash', hash).first()
                return res.json({ data: updated })
              }
            }
          }
        } catch (ghErr) {
          log.warn({ msg: 'GitHub PR check failed', error: ghErr.message })
          // Non-fatal: return current job state
        }
      }

      res.json({ data: job })
    } catch (err) {
      log.error({ msg: 'bugfixes/status error', error: err.message })
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  // ── POST /bugfixes/deploy/:hash ──────────────────────────────
  // Deploy fix: merge PR to dev, or trigger prod deploy workflow.

  router.post('/bugfixes/deploy/:hash', async (req, res) => {
    try {
      await requireSuperuser(req)

      const { hash } = req.params
      const { target } = req.body

      if (!HASH_REGEX.test(hash)) {
        return res.status(400).json({ error: 'Invalid hash' })
      }
      if (target !== 'dev' && target !== 'prod') {
        return res.status(400).json({ error: 'target must be "dev" or "prod"' })
      }
      if (!GITHUB_PAT) {
        return res.status(500).json({ error: 'GITHUB_PAT not configured' })
      }

      const job = await database('bugfix_jobs').where('error_hash', hash).first()
      if (!job) {
        return res.status(404).json({ error: 'No bugfix job found' })
      }

      const jobRepo = job.repo || DEFAULT_REPO
      if (!ALLOWED_REPOS.includes(jobRepo)) {
        return res.status(500).json({ error: 'Invalid repo in job record' })
      }

      if (target === 'dev') {
        // Merge PR to dev
        if (!job.pr_number) {
          return res.status(400).json({ error: 'No PR to merge' })
        }
        if (job.status !== 'pr_ready') {
          return res.status(400).json({ error: `Cannot deploy: status is "${job.status}"` })
        }

        const mergeResp = await githubApi(
          `/pulls/${job.pr_number}/merge`,
          {
            method: 'PUT',
            body: JSON.stringify({
              merge_method: 'squash',
              commit_title: `fix: AI bugfix for ${hash.slice(0, 8)}`,
            }),
          },
          jobRepo
        )

        if (!mergeResp.ok) {
          const body = await mergeResp.text()
          log.error({ msg: 'PR merge failed', status: mergeResp.status, body })
          return res.status(502).json({ error: 'Failed to merge PR' })
        }

        const mergeData = await mergeResp.json()

        await database('bugfix_jobs')
          .where('error_hash', hash)
          .update({
            status: 'deployed_dev',
            merge_sha: mergeData.sha || null,
            date_updated: new Date().toISOString(),
          })

        log.info({ msg: 'Bugfix merged to dev', hash, pr: job.pr_number })
        const updated = await database('bugfix_jobs').where('error_hash', hash).first()
        res.json({ success: true, data: updated })

      } else {
        // Deploy to prod via workflow dispatch
        if (!job.merge_sha) {
          return res.status(400).json({ error: 'No merge SHA — deploy to dev first' })
        }
        if (job.status !== 'deployed_dev') {
          return res.status(400).json({ error: `Cannot deploy to prod: status is "${job.status}"` })
        }

        const dispatchResp = await githubApi(
          '/actions/workflows/bugfix-deploy-prod.yml/dispatches',
          {
            method: 'POST',
            body: JSON.stringify({
              ref: 'dev',
              inputs: {
                merge_sha: job.merge_sha,
                error_hash: hash,
              },
            }),
          },
          jobRepo
        )

        if (dispatchResp.status !== 204) {
          const body = await dispatchResp.text()
          log.error({ msg: 'Prod deploy dispatch failed', status: dispatchResp.status, body })
          return res.status(502).json({ error: 'Failed to trigger prod deploy workflow' })
        }

        await database('bugfix_jobs')
          .where('error_hash', hash)
          .update({
            status: 'deployed_prod',
            date_updated: new Date().toISOString(),
          })

        log.info({ msg: 'Bugfix prod deploy triggered', hash })
        const updated = await database('bugfix_jobs').where('error_hash', hash).first()
        res.json({ success: true, data: updated })
      }
    } catch (err) {
      log.error({ msg: 'bugfixes/deploy error', error: err.message })
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  // ── POST /bugfixes/dismiss/:hash ─────────────────────────────
  // Mark error as solved via error_annotations.

  router.post('/bugfixes/dismiss/:hash', async (req, res) => {
    try {
      await requireSuperuser(req)

      const { hash } = req.params
      if (!HASH_REGEX.test(hash)) {
        return res.status(400).json({ error: 'Invalid hash' })
      }

      // Find error_date from bugfix_jobs or JSONL
      let errorDate = null
      const job = await database('bugfix_jobs').where('error_hash', hash).first()
      if (job) {
        errorDate = job.error_date
      }

      if (!errorDate) {
        // Search JSONL for this hash
        for (let i = 0; i < 7; i++) {
          const d = new Date()
          d.setDate(d.getDate() - i)
          const dateStr = d.toISOString().slice(0, 10)
          const entries = readErrorLogForDate(dateStr)
          for (const entry of entries) {
            if (computeErrorHash(entry) === hash) {
              errorDate = dateStr
              break
            }
          }
          if (errorDate) break
        }
      }

      if (!errorDate) {
        return res.status(404).json({ error: 'Error not found in recent logs or bugfix jobs' })
      }

      // Upsert annotation
      const now = new Date().toISOString()
      await database.raw(`
        INSERT INTO error_annotations (error_hash, error_date, status, note, user_created, date_created, date_updated)
        VALUES (?, ?, 'solved', 'Dismissed via bugfix dashboard', ?, ?, ?)
        ON CONFLICT (error_hash) DO UPDATE SET
          status = 'solved',
          note = COALESCE(error_annotations.note, 'Dismissed via bugfix dashboard'),
          date_updated = NOW()
      `, [hash, errorDate, req.accountability.user, now, now])

      // Also update bugfix_jobs if it exists
      if (job) {
        await database('bugfix_jobs')
          .where('error_hash', hash)
          .update({ status: 'dismissed', date_updated: now })
      }

      log.info({ msg: 'Error dismissed', hash })
      res.json({ success: true, hash, status: 'solved' })
    } catch (err) {
      log.error({ msg: 'bugfixes/dismiss error', error: err.message })
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  // ── POST /bugfixes/reopen/:hash ───────────────────────────────
  // Reopen a dismissed error (remove solved annotation).

  router.post('/bugfixes/reopen/:hash', async (req, res) => {
    try {
      await requireSuperuser(req)

      const { hash } = req.params
      if (!HASH_REGEX.test(hash)) {
        return res.status(400).json({ error: 'Invalid hash' })
      }

      // Remove solved annotation
      await database('error_annotations')
        .where('error_hash', hash)
        .where('status', 'solved')
        .del()

      // Reset bugfix_jobs status if it was dismissed
      await database('bugfix_jobs')
        .where('error_hash', hash)
        .where('status', 'dismissed')
        .update({ status: 'failed', date_updated: new Date().toISOString() })

      log.info({ msg: 'Error reopened', hash })
      res.json({ success: true, hash })
    } catch (err) {
      log.error({ msg: 'bugfixes/reopen error', error: err.message })
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  // ── POST /bugfixes/webhook/:hash ─────────────────────────────
  // Called by GitHub Actions on job completion (success or failure).
  // Authenticated via GITHUB_PAT in Authorization header.

  router.post('/bugfixes/webhook/:hash', async (req, res) => {
    try {
      const { hash } = req.params
      if (!HASH_REGEX.test(hash)) {
        return res.status(400).json({ error: 'Invalid hash' })
      }

      // Authenticate via Bearer token matching GITHUB_PAT or DIRECTUS_ADMIN_TOKEN
      const authHeader = req.headers.authorization || ''
      const token = authHeader.replace(/^Bearer\s+/i, '')
      const adminToken = process.env.DIRECTUS_ADMIN_TOKEN
      if (!safeTokenEqual(token, GITHUB_PAT) && !safeTokenEqual(token, adminToken)) {
        return res.status(401).json({ error: 'Unauthorized' })
      }

      const { status } = req.body // 'failed' or 'pr_ready'
      if (!['failed', 'pr_ready'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' })
      }

      await database('bugfix_jobs')
        .where('error_hash', hash)
        .where('status', 'fixing')
        .update({ status, date_updated: new Date().toISOString() })

      log.info({ msg: 'Bugfix webhook received', hash, status })
      res.json({ success: true })
    } catch (err) {
      log.error({ msg: 'bugfixes/webhook error', error: err.message })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── GET /bugfixes/public ─────────────────────────────────────
  // Public-facing fix summaries (any authenticated user).

  router.get('/bugfixes/public', async (req, res) => {
    try {
      requireAuth(req)

      const rows = await database('bugfix_jobs')
        .where('is_public', true)
        .whereIn('status', ['pr_ready', 'deployed_dev', 'deployed_prod'])
        .select({ date: 'date_created' }, 'public_summary', 'status')
        .orderBy('date_created', 'desc')
        .limit(50)

      res.json({ data: rows })
    } catch (err) {
      log.error({ msg: 'bugfixes/public error', error: err.message })
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  log.info('Bugfix endpoints registered: 6 routes')
}
