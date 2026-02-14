# Improve Developer Experience

Our development tools and workflows should continuously improve. Developers should
spend less time fighting tooling and more time shipping features.

## Mission Parameters

- **Cadence:** Continuous — check environment every 4 hours (`0 */4 * * *`)
- **Scope:** Monorepo tooling, CI/CD, local dev setup, documentation
- **Stakeholders:** Engineering team
- **TODO Limits:** 10 active, 50 backlog

## Pillars

### Build Performance
Reduce build times and improve caching. Developers should never wait more than
60 seconds for a local dev build.

**Success Metrics:**

| Metric | Slug | Type | Target | Warning | Direction | Collection |
|--------|------|------|--------|---------|-----------|------------|
| Average local build time | `local-build-time` | duration | < 60s | 90s | down | Every 4h via build profiler |
| CI build time (P95) | `ci-build-time` | duration | < 5 min | 7 min | down | Every 8h via GitHub Actions API |
| Build cache hit rate | `cache-hit-rate` | percentage | >= 80% | 70% | up | Daily via cache stats |
| Production bundle size | `bundle-size` | numeric | <= 500 KB | 550 KB | down | Weekly via bundle analyzer |

**Strategies:**
- Profile build pipeline quarterly — run comprehensive profiling to identify the slowest plugins, largest bundles, and most expensive transforms
- Evaluate new bundler releases — assess migration cost vs. performance gain when major versions ship
- Monitor cache invalidation patterns — track why caches miss (dependency updates, config changes, non-deterministic builds)
- Track bundle size regressions — fail CI when production bundle exceeds threshold

### Documentation Currency
Documentation should accurately reflect the current state of the system. Stale
docs are worse than no docs.

**Success Metrics:**

| Metric | Slug | Type | Target | Warning | Direction | Collection |
|--------|------|------|--------|---------|-----------|------------|
| Documented APIs that no longer exist | `stale-api-docs` | count | = 0 | 2 | down | Weekly doc-drift scan |
| New features without docs (past 2 weeks) | `undocumented-features` | count | = 0 | 2 | down | Weekly PR scan |
| Packages with up-to-date README | `readme-coverage` | percentage | >= 100% | 90% | up | Weekly README audit |
| Public API documentation coverage | `api-doc-coverage` | percentage | >= 95% | 85% | up | Weekly export scan |

**Strategies:**
- Weekly doc-drift scan — compare code exports to documented APIs, flag orphaned docs and undocumented exports
- PR bot for undocumented exports — ensure PRs adding new public APIs include documentation or create follow-up TODOs
- Quarterly full documentation audit — comprehensive review of all docs for accuracy, completeness, and clarity
- API doc coverage gate — fail CI when public API documentation coverage drops below threshold

### Onboarding Friction
New team members should be productive within their first week. The onboarding
path should be self-service and continuously validated.

**Success Metrics:**

| Metric | Slug | Type | Target | Warning | Direction | Collection |
|--------|------|------|--------|---------|-----------|------------|
| Time to first meaningful PR | `time-to-first-pr` | duration | < 3 days | 5 days | down | Weekly from HR + GitHub data |
| Setup script success rate | `setup-success-rate` | percentage | >= 95% | 90% | up | Monthly clean-env test |
| Manual setup steps not automated | `manual-setup-steps` | count | = 0 | 1 | down | Monthly checklist diff |
| Onboarding satisfaction (NPS) | `onboarding-nps` | rating | >= 8/10 | 7/10 | up | Monthly survey |

**Strategies:**
- Monthly onboarding dry-run — existing team member follows the full onboarding flow in a clean environment to catch regressions
- Track and eliminate every manual step — maintain a living checklist and automate one manual step per sprint
- Maintain golden-path automation scripts — single-command setup that handles all dependencies, env config, and initial data
- Quarterly onboarding retrospective — survey recent joiners and feed improvements back into the process

## Agents

### Mission Lead
- Model: claude-sonnet
- System prompt: See `/user/missions/prompts/developer-experience-lead.md`
- Responsibilities: Prioritize across pillars, generate TODO items, review completed work, update dashboards

### Pillar Owners
Each pillar can have a dedicated owner agent with domain-specific expertise. If no custom
template is specified, the default `pillar-owner` template (based on the researcher template)
is used.

- **Build Performance**: Custom template — `/user/missions/prompts/build-performance-owner.md`
  - Specializes in bundler performance, build caching, CI/CD optimization, profiling
- **Documentation Currency**: Custom template — `/user/missions/prompts/doc-currency-owner.md`
  - Specializes in doc-drift detection, documentation tooling, automated doc generation
- **Onboarding Friction**: Default template (researcher-based pillar-owner)
  - General-purpose research and analysis for onboarding improvement

### Workers
- deep-research-team: For investigating tools, benchmarking, analyzing trends
- coder: For implementing improvements, writing scripts, modifying configs
- writer: For documentation updates, report generation
