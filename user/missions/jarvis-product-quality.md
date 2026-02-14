# Ensure Jarvis Product Quality

Jarvis is our flagship AI assistant product. This mission ensures it delivers a
reliable, performant, and delightful user experience across every release.

## Mission Parameters

- **Cadence:** Continuous — monitor quality signals every 2 hours (`0 */2 * * *`)
- **Scope:** Jarvis core platform, API reliability, UX quality, regression prevention
- **Stakeholders:** Product team, engineering, QA, support
- **TODO Limits:** 15 active, 60 backlog

## Pillars

### Reliability & Uptime
Jarvis must be available and responsive. Users depend on it for critical workflows —
downtime directly impacts trust and retention.

**Success Metrics:**

| Metric | Slug | Type | Target | Warning | Direction | Collection |
|--------|------|------|--------|---------|-----------|------------|
| API uptime (30-day rolling) | `api-uptime` | percentage | >= 99.9% | 99.5% | up | Every 2h from status page |
| P95 API response latency | `api-latency-p95` | duration | < 500ms | 800ms | down | Every 2h from APM |
| Error rate (5xx responses) | `error-rate-5xx` | percentage | < 0.1% | 0.5% | down | Every 2h from logs |
| Mean time to recovery (MTTR) | `mttr` | duration | < 30 min | 60 min | down | Per-incident from PagerDuty |

**Strategies:**
- Continuous synthetic monitoring — run health checks from multiple regions every 60 seconds
- Automated rollback on error rate spike — deploy canary with auto-rollback at 1% error threshold
- Weekly incident review — analyze root causes, update runbooks, close action items
- Chaos engineering quarterly — inject controlled failures to validate resilience

### Test Coverage & Regression Prevention
Every release should be safer than the last. Comprehensive test coverage and
fast feedback loops catch regressions before they reach users.

**Success Metrics:**

| Metric | Slug | Type | Target | Warning | Direction | Collection |
|--------|------|------|--------|---------|-----------|------------|
| Unit test coverage | `unit-test-coverage` | percentage | >= 85% | 75% | up | Daily from CI coverage report |
| Integration test pass rate | `integration-pass-rate` | percentage | >= 99% | 95% | up | Every CI run |
| E2E test suite duration | `e2e-duration` | duration | < 15 min | 20 min | down | Every CI run |
| Escaped defects per release | `escaped-defects` | count | = 0 | 2 | down | Weekly from bug tracker |

**Strategies:**
- Coverage ratchet — CI fails if coverage drops below current high-water mark
- Flaky test quarantine — auto-detect and isolate flaky tests, track fix SLA
- E2E critical path suite — maintain a fast-running subset covering the top 10 user journeys
- Post-release defect analysis — for each escaped defect, add a regression test and trace the gap

### User Experience Quality
Quality isn't just about uptime — the product should feel fast, intuitive, and
polished. UX quality directly drives adoption and retention.

**Success Metrics:**

| Metric | Slug | Type | Target | Warning | Direction | Collection |
|--------|------|------|--------|---------|-----------|------------|
| Core Web Vitals (LCP) | `lcp` | duration | < 2.5s | 4s | down | Daily from RUM data |
| User satisfaction (CSAT) | `csat` | rating | >= 4.2/5 | 3.8/5 | up | Weekly from in-app survey |
| Accessibility audit score | `a11y-score` | percentage | >= 95% | 85% | up | Weekly via axe-core |
| UI error rate (client-side) | `client-error-rate` | percentage | < 0.5% | 1% | down | Daily from Sentry |

**Strategies:**
- Performance budget enforcement — fail CI when Core Web Vitals exceed thresholds
- Monthly UX audit — review top 5 user flows for friction points, accessibility, and responsiveness
- Client-side error triage — auto-file bugs for new client errors, prioritize by user impact
- Quarterly usability testing — run moderated sessions with real users, feed findings into backlog

## Agents

### Mission Lead
- Model: claude-sonnet
- System prompt: See `/user/missions/prompts/jarvis-quality-lead.md`
- Responsibilities: Triage quality signals, prioritize cross-pillar, review completed fixes, update dashboards

### Pillar Owners
- **Reliability & Uptime**: Custom template — `/user/missions/prompts/reliability-owner.md`
  - Specializes in SRE, incident response, monitoring, infrastructure resilience
- **Test Coverage & Regression Prevention**: Custom template — `/user/missions/prompts/test-quality-owner.md`
  - Specializes in test strategy, coverage analysis, CI optimization, flaky test management
- **User Experience Quality**: Default template (researcher-based pillar-owner)
  - General-purpose research for UX metrics, accessibility, performance budgets

### Workers
- deep-research-team: For investigating incidents, benchmarking performance, analyzing trends
- coder: For writing tests, fixing regressions, implementing monitoring, CI improvements
- writer: For runbook updates, incident reports, quality dashboards
