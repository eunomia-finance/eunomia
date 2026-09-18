-- Applied 2026-09-18 (migration `activity_action_verbs`).
--
-- The live `activity_action_check` (added by hand in July, before 0003 was written) only
-- knew the five original verbs: deploy, fund, whitelist, pay, reject. Everything the Leash
-- era logs — session_start, session_revoke, agent_pay, pause, withdraw, limits, register —
-- was refused with a 400 ever since, silently: logging is best-effort by design, so the
-- user's action succeeded and only the row was lost. The visible symptom, found by Bekir
-- while testing on 2026-09-18: the agent paid 1 XLM, the Leash showed 49 left of 50, and
-- the Overview ledger showed nothing.
--
-- This replaces that constraint with the allowlist the code emits. The list is mirrored by
-- `ActivityAction` in web/src/lib/activity.ts and guarded by activity.migration.test.ts,
-- so adding a verb in code without adding it here fails the unit suite instead of the
-- production feed.
alter table public.activity drop constraint if exists activity_action_check;
alter table public.activity drop constraint if exists activity_action_allowed;
alter table public.activity
  add constraint activity_action_allowed check (action in (
    'deploy', 'fund', 'whitelist', 'pay', 'reject', 'pause', 'withdraw', 'limits',
    'session_start', 'session_revoke', 'agent_pay', 'register'
  ));
