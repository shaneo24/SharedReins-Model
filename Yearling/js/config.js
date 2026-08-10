/* Shared-data connection settings.
 *
 * Fill these in from your Supabase project: Dashboard -> Project Settings ->
 * API. You want the *Project URL* and the *anon / public* key.
 *
 * BOTH VALUES ARE MEANT TO BE PUBLIC. They ship in the page source of every
 * Supabase app there is, and this file is committed to a public repo on
 * purpose. They are not a secret and they are not what protects your data:
 * every table has row-level security on with no policy, so the anon key by
 * itself opens nothing. The only ways in are the two functions in
 * shared/schema.sql, and both check the access code first.
 *
 * THE ACCESS CODE IS NOT IN THIS FILE and must never be put here. It lives in
 * the database, and each person types it once on their own machine.
 *
 * Leave the placeholders alone and both models run exactly as they did
 * before: local-only, no network, no prompts, no sharing.
 */
window.SHARED_REINS_CONFIG = {
  url: 'https://scbtystrvjtfyvregggk.supabase.co',
  anonKey: 'sb_publishable_iUdETWLOVLsFOr9pZL2TSQ_8p0-RNJ-'
};
