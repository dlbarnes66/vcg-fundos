import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
const root = process.argv[2] ?? fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite();
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('pass:', m); };

await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text, last_sign_in_at timestamptz);
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
`);
for (const m of ['0001_init.sql', '0002_crm_handoff.sql', '0003_team_and_funds.sql', '0004_document_studio.sql', '0005_investor_onboarding.sql', '0006_mfa_notify_cleanup.sql', '0007_counsel_role.sql', '0008_counsel_review.sql', '0009_compliance_tracking.sql']) await db.exec(readFileSync(`${root}/supabase/migrations/${m}`, 'utf8'));
await db.exec(readFileSync(`${root}/supabase/seed.sql`, 'utf8'));

const owner = '11111111-1111-1111-1111-111111111111';
const lpA = '22222222-2222-2222-2222-222222222222';
const other = '33333333-3333-3333-3333-333333333333';
await db.exec(`insert into auth.users (id,email) values ('${owner}','owner@x.com'),('${lpA}','a@example.com'),('${other}','other@y.com');`);
await db.exec(`select bootstrap_owner('owner@x.com'); select seed_demo('vcg');`);
await db.exec(`select bootstrap_owner('other@y.com','Other Co','other');`);
await db.exec(`
  insert into memberships select o.id, '${lpA}', 'investor' from organizations o where slug='vcg';
  update investors set portal_user_id='${lpA}' where email='a@example.com';
`);
await db.exec(`grant usage on schema public, auth, storage to authenticated;
  grant all on all tables in schema public to authenticated; grant all on all tables in schema storage to authenticated;
  grant usage, select on all sequences in schema public to authenticated;`);

async function as(uid, sql, aal = 'aal1') {
  await db.exec(`set role authenticated; set test.uid = '${uid}'; set test.jwt = '{"aal":"${aal}"}';`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; set test.uid = ''; set test.jwt = '';`); }
}

ok((await as(owner, 'select * from investors')).rows.length === 5, 'owner sees 5 investors');
ok((await as(lpA, 'select * from investors')).rows.length === 1, 'LP sees only own investor record');
ok((await as(other, 'select * from investors')).rows.length === 0, 'other org sees none');
ok((await as(lpA, 'select * from funds')).rows.length === 1, 'LP sees fund they committed to');
const ca = (await as(owner, 'select * from capital_accounts order by committed desc')).rows;
ok(ca.length === 2 && Number(ca[1].contributed) === 100000 && Number(ca[1].unfunded) === 0, 'capital account math');
ok(Number(ca[0].unfunded) === 250000, 'unfunded for committed-not-funded');
ok((await as(lpA, 'select * from capital_accounts')).rows.length === 1, 'LP sees one capital account');

let threw = false;
try { await db.exec(`update capital_transactions set amount = 1`); } catch { threw = true; }
ok(threw, 'capital transactions cannot be updated (even as superuser)');

const t = (await db.query(`select * from capital_transactions limit 1`)).rows[0];
await as(owner, `insert into capital_transactions (organization_id,fund_id,investor_id,kind,amount,effective_date,reverses_id,posted_by)
  values ('${t.organization_id}','${t.fund_id}','${t.investor_id}','reversal',${t.amount},current_date,'${t.id}','${owner}')`);
const after = (await as(owner, `select contributed from capital_accounts where investor_id='${t.investor_id}'`)).rows[0];
ok(Number(after.contributed) === 0, 'reversal nets contribution to zero');

threw = false;
try { await as(owner, `insert into capital_transactions (organization_id,fund_id,investor_id,kind,amount,effective_date,reverses_id,posted_by)
  values ('${t.organization_id}','${t.fund_id}','${t.investor_id}','reversal',${t.amount},current_date,'${t.id}','${owner}')`); } catch { threw = true; }
ok(threw, 'cannot reverse twice');

threw = false;
try { await as(lpA, `insert into capital_transactions (organization_id,fund_id,investor_id,kind,amount,effective_date,posted_by)
  values ('${t.organization_id}','${t.fund_id}','${t.investor_id}','contribution',1,current_date,'${lpA}')`); } catch { threw = true; }
ok(threw, 'LP cannot post capital');

threw = false;
try { await as(other, `insert into investors (organization_id, display_name) values ('${t.organization_id}','x')`); } catch { threw = true; }
ok(threw, 'other org cannot insert into VCG');

const audits = (await as(owner, 'select count(*)::int n from audit_events')).rows[0].n;
ok(audits > 5, `audit events recorded (${audits})`);

// documents visibility
await db.exec(`insert into documents (organization_id, title, visibility, storage_path)
  select id, 'PPM', 'all_investors', id || '/ppm.pdf' from organizations where slug='vcg';
  insert into documents (organization_id, title, visibility, storage_path)
  select id, 'Internal memo', 'internal', id || '/memo.pdf' from organizations where slug='vcg';
  insert into storage.objects (bucket_id, name) select 'documents', storage_path from documents;`);
ok((await as(lpA, 'select * from documents')).rows.length === 1, 'LP sees shared doc only');
ok((await as(lpA, 'select * from storage.objects')).rows.length === 1, 'LP storage access follows document visibility');
ok((await as(other, 'select * from storage.objects')).rows.length === 0, 'other org cannot read files');

// 506(c) guardrail: cannot accept a commitment from an unverified investor
const unverified = (await db.query(`select i.id, i.organization_id, f.id fund_id from investors i join funds f on f.organization_id=i.organization_id where i.email='d@example.com'`)).rows[0];
threw = false;
try { await as(owner, `insert into commitments (organization_id,fund_id,investor_id,amount,status) values ('${unverified.organization_id}','${unverified.fund_id}','${unverified.id}',75000,'accepted')`); } catch { threw = true; }
ok(threw, 'cannot accept commitment from unverified investor');
await as(owner, `insert into commitments (organization_id,fund_id,investor_id,amount,status) values ('${unverified.organization_id}','${unverified.fund_id}','${unverified.id}',75000,'pending')`);
threw = false;
try { await as(owner, `update commitments set status='accepted' where investor_id='${unverified.id}'`); } catch { threw = true; }
ok(threw, 'cannot flip pending to accepted while unverified');

// Portal linking: only owner/admin, and not onto staff accounts
const lpE = '44444444-4444-4444-4444-444444444444';
await db.exec(`insert into auth.users (id,email) values ('${lpE}','e@example.com')`);
const invE = (await db.query(`select id from investors where email='e@example.com'`)).rows[0].id;
threw = false;
try { await as(lpA, `select link_portal_user('${invE}','e@example.com')`); } catch { threw = true; }
ok(threw, 'LP cannot grant portal access');
await as(owner, `select link_portal_user('${invE}','e@example.com')`);
ok((await as(lpE, 'select * from investors')).rows.length === 1, 'linked LP sees own record');
threw = false;
try { await as(owner, `select link_portal_user('${invE}','owner@x.com')`); } catch { threw = true; }
ok(threw, 'cannot link a staff login as an investor');

// ── CRM OS handoff ──
await db.exec(`grant usage on schema public to anon; grant all on all tables in schema public to anon;`);
async function asAnon(sql) {
  await db.exec(`set role anon; set test.uid = '';`);
  try { return await db.query(sql); } finally { await db.exec(`reset role;`); }
}
const vcgOrg = (await db.query(`select id from organizations where slug='vcg'`)).rows[0].id;
const otherOrg = (await db.query(`select id from organizations where slug='other'`)).rows[0].id;

threw = false;
try { await as(lpA, `select create_intake_key('${vcgOrg}','x')`); } catch { threw = true; }
ok(threw, 'LP cannot create API key');
threw = false;
try { await as(other, `select create_intake_key('${vcgOrg}','x')`); } catch { threw = true; }
ok(threw, 'other org cannot create key for VCG');

const key = (await as(owner, `select create_intake_key('${vcgOrg}','CRM OS') k`)).rows[0].k;
ok(/^fos_[0-9a-f]{64}$/.test(key), 'key format');
const stored = (await db.query(`select key_hash, key_prefix from intake_keys`)).rows[0];
ok(!stored.key_hash.includes(key.slice(4)) && stored.key_prefix === key.slice(0, 12), 'only hash + prefix stored');

threw = false;
try { await asAnon(`select intake_investor('fos_bad','crm_os','c1','X','x@y.com')`); } catch { threw = true; }
ok(threw, 'bad key rejected');

const r1 = (await asAnon(`select intake_investor('${key}','crm_os','c-100','New Prospect','New@Prospect.com', null, 'trust', 100000, 'Webinar attendee')  r`)).rows[0].r;
ok(r1.created === true && r1.stage === 'qualified', 'new lead created at qualified');
const r2 = (await asAnon(`select intake_investor('${key}','crm_os','c-100','New Prospect','new@prospect.com') r`)).rows[0].r;
ok(r2.created === false && r2.investor_id === r1.investor_id, 'resend dedupes on external id');

// Existing investor matched by email keeps its stage
const rC = (await asAnon(`select intake_investor('${key}','crm_os','c-200','Sample Holdings','C@example.com') r`)).rows[0].r;
ok(rC.created === false && rC.stage === 'docs_sent', 'email match does not move stage');

ok((await as(other, `select * from investors`)).rows.length === 0, 'handoff lands only in key org');
const acts = (await as(owner, `select count(*)::int n from investor_activities where kind='handoff'`)).rows[0].n;
ok(acts === 3, 'handoff activity logged');

threw = false;
try { await asAnon(`select intake_investor('${key}','crm_os','c-300','','')`); } catch { threw = true; }
ok(threw, 'validation rejects empty name / bad email');

ok((await asAnon(`select * from intake_keys`)).rows.length === 0, 'anon cannot read keys');
ok((await asAnon(`select * from investors`)).rows.length === 0, 'anon cannot read investors');

const kid = (await db.query(`select id from intake_keys`)).rows[0].id;
await as(owner, `select revoke_intake_key('${kid}')`);
threw = false;
try { await asAnon(`select intake_investor('${key}','crm_os','c-400','Y','y@z.com')`); } catch { threw = true; }
ok(threw, 'revoked key rejected');

// ── Team management ──
const ir = '55555555-5555-5555-5555-555555555555';
const adm = '66666666-6666-6666-6666-666666666666';
await db.exec(`insert into auth.users (id,email) values ('${ir}','ir@x.com'),('${adm}','admin@x.com')`);
await as(owner, `select add_staff_member('${vcgOrg}','IR@x.com','investor_relations')`);
await as(owner, `select add_staff_member('${vcgOrg}','admin@x.com','admin')`);
const team = (await as(owner, `select * from org_members('${vcgOrg}')`)).rows;
ok(team.length === 3 && team.every((m) => m.role !== 'investor'), 'org_members lists staff only, with emails');
threw = false; try { await as(ir, `select * from org_members('${vcgOrg}')`); } catch { threw = true; }
ok(threw, 'IR cannot list team');
threw = false; try { await as(adm, `select add_staff_member('${vcgOrg}','other@y.com','admin')`); } catch { threw = true; }
ok(threw, 'admin cannot grant admin');
threw = false; try { await as(other, `select add_staff_member('${vcgOrg}','other@y.com','viewer')`); } catch { threw = true; }
ok(threw, 'other org cannot add to VCG');
threw = false; try { await as(owner, `select add_staff_member('${vcgOrg}','a@example.com','viewer')`); } catch { threw = true; }
ok(threw, 'investor login cannot become staff');
threw = false; try { await as(adm, `select set_member_role('${vcgOrg}','${ir}','admin')`); } catch { threw = true; }
ok(threw, 'admin cannot change roles');
threw = false; try { await as(owner, `select set_member_role('${vcgOrg}','${owner}','viewer')`); } catch { threw = true; }
ok(threw, 'last owner cannot be demoted');
threw = false; try { await as(owner, `select remove_member('${vcgOrg}','${owner}')`); } catch { threw = true; }
ok(threw, 'last owner cannot be removed');
await as(owner, `select remove_member('${vcgOrg}','${lpE}')`);
const unlinked = (await db.query(`select portal_user_id from investors where email='e@example.com'`)).rows[0];
ok(unlinked.portal_user_id === null, 'removing an investor login unlinks the portal');
ok((await as(lpE, 'select * from investors')).rows.length === 0, 'removed investor sees nothing');
threw = false; try { await as(ir, `select user_exists('${vcgOrg}','x@y.com')`); } catch { threw = true; }
ok(threw, 'IR cannot probe which emails have accounts');
const pe = (await as(owner, `select portal_email(id) e from investors where email='a@example.com'`)).rows[0].e;
ok(pe === 'a@example.com', 'portal_email for owner');
threw = false; try { await as(lpA, `select portal_email(id) from investors where email='a@example.com'`); } catch { threw = true; }
ok(threw, 'LP cannot call portal_email');

// Fund edits are owner/admin only
threw = false; try { await as(ir, `update funds set target_size = 1`); } catch { threw = true; }
const tgt = (await db.query(`select target_size from funds limit 1`)).rows[0].target_size;
ok(Number(tgt) === 10000000, 'IR cannot change fund terms');
await as(owner, `update funds set pref_rate = 0.0725`);
ok((await db.query(`select count(*)::int n from audit_events where target_table='funds' and action='update'`)).rows[0].n === 1, 'fund term change is audited');

// ── Document Studio ──
const fundRow = (await db.query(`select id from funds where organization_id='${vcgOrg}' limit 1`)).rows[0];
const dId = (await as(owner, `insert into doc_drafts (organization_id,fund_id,kind,terms_snapshot,created_by) values ('${vcgOrg}','${fundRow.id}','ppm','{}','${owner}') returning id`)).rows[0].id;
await as(owner, `insert into doc_sections (organization_id,draft_id,position,key,heading,content) values ('${vcgOrg}','${dId}',0,'cover','Cover','Text')`);
ok((await as(ir, `select * from doc_drafts`)).rows.length === 1, 'IR can read drafts');
threw = false; try { await as(ir, `update doc_sections set content='x'`); } catch { threw = true; }
ok((await db.query(`select content from doc_sections`)).rows[0].content === 'Text', 'IR cannot edit drafts');
ok((await as(lpA, `select * from doc_drafts`)).rows.length === 0, 'investors never see drafts');
ok((await as(other, `select * from doc_sections`)).rows.length === 0, 'other org cannot see drafts');
threw = false; try { await as(adm, `update doc_drafts set status='approved', approved_by_name='X', approved_at=now() where id='${dId}'`); } catch { threw = true; }
ok(threw, 'admin cannot record counsel approval');
threw = false; try { await as(owner, `update doc_drafts set status='approved' where id='${dId}'`); } catch { threw = true; }
ok(threw, 'approval requires counsel name and date');
await as(owner, `update doc_drafts set status='approved', approved_by_name='Jane Doe, Savvi', approved_at=now() where id='${dId}'`);
threw = false; try { await as(owner, `update doc_sections set content='changed' where draft_id='${dId}'`); } catch { threw = true; }
ok(threw, 'approved version sections are locked');
threw = false; try { await as(owner, `update doc_drafts set approved_by_name='Someone else' where id='${dId}'`); } catch { threw = true; }
ok(threw, 'approval record cannot be altered');
await as(owner, `update doc_drafts set status='superseded' where id='${dId}'`);
ok((await db.query(`select status from doc_drafts where id='${dId}'`)).rows[0].status === 'superseded', 'approved version can be superseded');
threw = false; try { await as(owner, `delete from doc_drafts where id='${dId}'`); } catch { threw = true; }
ok((await db.query(`select count(*)::int n from doc_drafts`)).rows[0].n === 1, 'superseded/approved versions cannot be deleted');
threw = false; try { await as(owner, `insert into doc_checks (organization_id,fund_id,sources,findings,created_by) values ('${vcgOrg}','${fundRow.id}','[]','[]','${adm}')`); } catch { threw = true; }
ok(threw, 'check must be recorded as the caller');

// ── Investor onboarding ──
const lpD = '77777777-7777-7777-7777-777777777777';
await db.exec(`insert into auth.users (id,email) values ('${lpD}','d@example.com')`);
await as(owner, `select link_portal_user(id,'d@example.com') from investors where email='d@example.com'`);
const invD = (await db.query(`select id from investors where email='d@example.com'`)).rows[0].id;
const fundId = fundRow.id;
// a second fund the LP was NOT invited to
await db.exec(`insert into funds (organization_id,name,target_size) values ('${vcgOrg}','Fund II',5000000)`);
const sub = (await as(owner, `insert into subscriptions (organization_id,fund_id,investor_id) values ('${vcgOrg}','${fundId}','${invD}') returning id`)).rows[0].id;
ok((await as(lpD, `select name from funds`)).rows.map(r=>r.name).join() === 'VCG Veterans Housing Fund I', 'LP sees only the fund they were invited to');
ok((await as(lpD, `select * from subscriptions`)).rows.length === 1, 'LP sees own subscription');
ok((await as(lpA, `select * from subscriptions`)).rows.length === 0, 'other LP cannot see it');
threw = false; try { await as(lpD, `update subscriptions set status='approved'`); } catch { threw = true; }
ok((await db.query(`select status from subscriptions where id='${sub}'`)).rows[0].status === 'in_progress', 'LP cannot update subscription directly');
threw = false; try { await as(lpA, `select lp_save_profile('${sub}','X','individual','123 Main St','','','','','','AL')`); } catch { threw = true; }
ok(threw, 'other LP cannot fill in this subscription');

await as(lpD, `select lp_save_profile('${sub}','Sample Investor D','individual','1 Main St, Mobile AL','555','','','','','AL')`);
threw = false; try { await as(lpD, `select lp_sign('${sub}',75000,'Sample D','${'a'.repeat(64)}',null,'1.1.1.1','ua')`); } catch { threw = true; }
ok(threw, 'cannot sign before earlier steps');

// LP uploads into own folder only
const goodPath = `${vcgOrg}/lp/${invD}/w9.pdf`;
await as(lpD, `insert into storage.objects (bucket_id,name) values ('documents','${goodPath}')`);
threw = false; try { await as(lpD, `insert into storage.objects (bucket_id,name) values ('documents','${vcgOrg}/lp/${invE}/x.pdf')`); } catch { threw = true; }
ok(threw, 'LP cannot upload into another investor folder');
threw = false; try { await as(lpD, `insert into storage.objects (bucket_id,name) values ('documents','${vcgOrg}/x.pdf')`); } catch { threw = true; }
ok(threw, 'LP cannot upload outside their folder');
const w9 = (await as(lpD, `insert into documents (organization_id,investor_id,title,category,visibility,storage_path,uploaded_by) values ('${vcgOrg}','${invD}','W-9','tax','investor','${goodPath}','${lpD}') returning id`)).rows[0].id;
threw = false; try { await as(lpD, `insert into documents (organization_id,investor_id,title,category,visibility,storage_path,uploaded_by) values ('${vcgOrg}','${invD}','x','offering','all_investors','${vcgOrg}/lp/${invD}/y.pdf','${lpD}')`); } catch { threw = true; }
ok(threw, 'LP cannot publish documents to all investors');
ok((await as(lpA, `select * from documents where id='${w9}'`)).rows.length === 0, "other LP cannot see someone's W-9");
ok((await as(ir, `select * from documents where id='${w9}'`)).rows.length === 1, 'staff can see uploaded W-9');

await as(lpD, `select lp_attach('${sub}','w9','${w9}')`);
await as(lpD, `select lp_ack_documents('${sub}','[{"id":"x","title":"PPM"}]')`);
await as(lpD, `select lp_set_accreditation('${sub}','net_worth','')`);
const acc = (await as(lpD, `insert into documents (organization_id,investor_id,title,category,visibility,storage_path,uploaded_by) values ('${vcgOrg}','${invD}','CPA letter','accreditation','investor','${vcgOrg}/lp/${invD}/letter.pdf','${lpD}') returning id`)).rows[0].id;
await as(lpD, `select lp_attach('${sub}','accreditation','${acc}')`);
const packet = (await as(lpD, `insert into documents (organization_id,investor_id,title,category,visibility,storage_path,uploaded_by) values ('${vcgOrg}','${invD}','Signed sub','subscription','investor','${vcgOrg}/lp/${invD}/signed.pdf','${lpD}') returning id`)).rows[0].id;
threw = false; try { await as(lpD, `select lp_sign('${sub}',10000,'Sample D','${'a'.repeat(64)}','${packet}','1.1.1.1','ua')`); } catch { threw = true; }
ok(threw, 'below-minimum amount rejected');
await as(lpD, `select lp_sign('${sub}',75000,'Sample Investor D','${'a'.repeat(64)}','${packet}','1.1.1.1','ua')`);
await as(lpD, `select lp_submit('${sub}')`);
threw = false; try { await as(lpD, `select lp_set_accreditation('${sub}','income','')`); } catch { threw = true; }
ok(threw, 'LP cannot change after submitting');
ok((await as(lpD, `select * from fund_wire_instructions`)).rows.length === 0, 'no wire instructions before acceptance');
await as(owner, `insert into fund_wire_instructions (fund_id,organization_id,instructions) values ('${fundId}','${vcgOrg}','Bank X acct 123')`);
ok((await as(lpD, `select * from fund_wire_instructions`)).rows.length === 0, 'wire instructions hidden until approved');
threw = false; try { await as(adm, `insert into fund_wire_instructions (fund_id,organization_id,instructions) values ('${fundId}','${vcgOrg}','evil') on conflict (fund_id) do update set instructions='evil'`); } catch { threw = true; }
ok((await db.query(`select instructions from fund_wire_instructions`)).rows[0].instructions === 'Bank X acct 123', 'only owner can set wire instructions');

threw = false; try { await as(ir, `select approve_subscription('${sub}', current_date + 90, '')`); } catch { threw = true; }
ok(threw, 'IR cannot approve');
threw = false; try { await as(owner, `select approve_subscription('${sub}', current_date - 1, '')`); } catch { threw = true; }
ok(threw, 'expiry must be in the future');
await as(owner, `select approve_subscription('${sub}', current_date + 90, 'Letter from CPA reviewed')`);
const invNow = (await db.query(`select accreditation_status, stage from investors where id='${invD}'`)).rows[0];
ok(invNow.accreditation_status === 'verified' && invNow.stage === 'committed', 'approval verifies accreditation and moves stage');
ok((await as(lpD, `select amount, status from commitments`)).rows.some(r => Number(r.amount) === 75000 && r.status === 'accepted'), 'approval creates accepted commitment');
ok((await as(lpD, `select * from fund_wire_instructions`)).rows.length === 1, 'wire instructions visible after acceptance');
ok((await as(lpA, `select * from fund_wire_instructions`)).rows.length === 1 , 'LP A (already accepted in seed) also sees them');
ok((await as(lpE, `select * from fund_wire_instructions`)).rows.length === 0, 'unlinked LP sees no wire instructions');

// ── Notifications, MFA, demo cleanup ──
const notifyTo = (await as(lpD, `select * from subscription_notify_emails('${sub}')`)).rows.map(r => Object.values(r)[0]).sort();
ok(notifyTo.join() === 'admin@x.com,owner@x.com', 'submission notifies owners/admins');
threw = false; try { await as(lpA, `select * from subscription_notify_emails('${sub}')`); } catch { threw = true; }
ok(threw, "another LP can't query notification recipients");
ok((await as(ir, `select portal_email(id) e from investors where email='d@example.com'`)).rows[0].e === 'd@example.com', 'IR can look up portal email to notify');

threw = false; try { await as(owner, `select set_require_staff_mfa('${vcgOrg}', true)`); } catch { threw = true; }
ok(threw, 'cannot require MFA without an MFA session yourself');
await as(owner, `select set_require_staff_mfa('${vcgOrg}', true)`, 'aal2');
const tx = (await db.query(`select organization_id, fund_id, investor_id from capital_transactions limit 1`)).rows[0];
threw = false; try { await as(owner, `insert into capital_transactions (organization_id,fund_id,investor_id,kind,amount,effective_date,posted_by) values ('${tx.organization_id}','${tx.fund_id}','${tx.investor_id}','distribution',1,current_date,'${owner}')`); } catch { threw = true; }
ok(threw, 'MFA required: posting money without MFA is blocked');
await as(owner, `insert into capital_transactions (organization_id,fund_id,investor_id,kind,amount,effective_date,posted_by) values ('${tx.organization_id}','${tx.fund_id}','${tx.investor_id}','distribution',1,current_date,'${owner}')`, 'aal2');
ok(true, 'MFA required: posting money with MFA works');
ok((await as(owner, `select * from investors`)).rows.length > 0, 'MFA does not block reading');
threw = false; try { await as(owner, `update fund_wire_instructions set instructions='x'`); } catch { threw = true; }
ok((await db.query(`select instructions from fund_wire_instructions`)).rows[0].instructions === 'Bank X acct 123', 'wire instructions need MFA when required');

threw = false; try { await as(owner, `select purge_demo_data('${vcgOrg}','yes')`, 'aal2'); } catch { threw = true; }
ok(threw, 'purge needs the confirmation phrase');
threw = false; try { await as(adm, `select purge_demo_data('${vcgOrg}','DELETE DEMO DATA')`, 'aal2'); } catch { threw = true; }
ok(threw, 'admin cannot purge');
await db.exec(`insert into investors (organization_id, display_name, email) values ('${vcgOrg}','Real Person','real@gmail.com')`);
const removed = (await as(owner, `select purge_demo_data('${vcgOrg}','DELETE DEMO DATA') n`, 'aal2')).rows[0].n;
const left = (await db.query(`select email from investors where organization_id='${vcgOrg}'`)).rows.map(r => r.email);
ok(removed === 5 && left.length === 2 && !left.some(e => e?.endsWith('@example.com')), `purge removed ${removed} sample investors, kept real ones`);
const realInv = (await db.query(`select id from investors where email='real@gmail.com'`)).rows[0].id;
await db.exec(`insert into capital_transactions (organization_id,fund_id,investor_id,kind,amount,effective_date) values ('${vcgOrg}','${fundId}','${realInv}','contribution',5,current_date)`);
threw = false; try { await db.exec(`update capital_transactions set amount = 2`); } catch { threw = true; }
ok(threw, 'append-only protection is back on after purge');
ok((await as(lpD, `select * from investors`)).rows.length === 0, 'purged sample LP loses access');

// ── Outside counsel ──
await as(owner, `select set_require_staff_mfa('${vcgOrg}', false)`, 'aal2');
const cns = '88888888-8888-8888-8888-888888888888';
await db.exec(`insert into auth.users (id,email) values ('${cns}','jane@savvi.law')`);
await as(adm, `select add_staff_member('${vcgOrg}','jane@savvi.law','counsel')`);
ok((await as(owner, `select role from org_members('${vcgOrg}') where email='jane@savvi.law'`)).rows[0].role === 'counsel', 'admin can invite counsel; shows on team');
ok((await as(cns, `select * from investors`)).rows.length === 0, 'counsel cannot see investors');
ok((await as(cns, `select * from commitments`)).rows.length === 0, 'counsel cannot see commitments');
ok((await as(cns, `select * from capital_transactions`)).rows.length === 0, 'counsel cannot see capital');
ok((await as(cns, `select * from subscriptions`)).rows.length === 0, 'counsel cannot see subscriptions');
ok((await as(cns, `select * from fund_wire_instructions`)).rows.length === 0, 'counsel cannot see wire instructions');
ok((await as(cns, `select * from funds`)).rows.length >= 1, 'counsel can read fund terms');
await db.exec(`insert into documents (organization_id,title,category,visibility,storage_path) values ('${vcgOrg}','PPM draft','offering','internal','${vcgOrg}/ppm-draft.pdf'),('${vcgOrg}','Board memo','general','internal','${vcgOrg}/memo2.pdf')`);
const cdocs = (await as(cns, `select title from documents`)).rows.map(r => r.title);
ok(cdocs.includes('PPM draft') && !cdocs.includes('Board memo') && !cdocs.includes('W-9'), 'counsel sees offering docs only, never investor files');

const d2 = (await as(owner, `insert into doc_drafts (organization_id,fund_id,kind,version,terms_snapshot,created_by) values ('${vcgOrg}','${fundId}','lpa',1,'{}','${owner}') returning id`)).rows[0].id;
const s1 = (await as(owner, `insert into doc_sections (organization_id,draft_id,position,key,heading,content) values ('${vcgOrg}','${d2}',0,'formation','Art 1','Formed in [[MISSING: state]]') returning id`)).rows[0].id;
ok((await as(cns, `select * from doc_sections where draft_id='${d2}'`)).rows.length === 1, 'counsel can read drafts');
threw = false; try { await as(cns, `update doc_sections set content='x' where id='${s1}'`); } catch { threw = true; }
ok((await db.query(`select content from doc_sections where id='${s1}'`)).rows[0].content.startsWith('Formed'), 'counsel cannot edit draft text');
await as(cns, `insert into doc_comments (organization_id,draft_id,section_id,author_id,body,author_email) values ('${vcgOrg}','${d2}','${s1}','${cns}','Use Delaware','spoof@x.com')`);
ok((await as(owner, `select author_email from doc_comments`)).rows[0].author_email === 'jane@savvi.law', 'comment author email comes from login, not input');
threw = false; try { await as(cns, `insert into doc_comments (organization_id,draft_id,author_id,body) values ('${vcgOrg}','${d2}','${owner}','fake')`); } catch { threw = true; }
ok(threw, 'cannot comment as someone else');
ok((await as(lpA, `select * from doc_comments`)).rows.length === 0, 'investors never see comments');
threw = false; try { await as(cns, `select counsel_approve('${d2}','ok')`); } catch { threw = true; }
ok(threw, 'counsel cannot approve while items are open');
await as(owner, `update doc_sections set content='Formed in Delaware' where id='${s1}'`);
threw = false; try { await as(ir, `select counsel_approve('${d2}','ok')`); } catch { threw = true; }
ok(threw, 'only counsel can use counsel sign-off');
await as(cns, `select counsel_approve('${d2}','Approved for distribution')`);
const ap = (await db.query(`select status, approved_by_name from doc_drafts where id='${d2}'`)).rows[0];
ok(ap.status === 'approved' && ap.approved_by_name === 'Counsel: jane@savvi.law', 'counsel approval recorded under their own login');
threw = false; try { await as(adm, `select add_staff_member('${vcgOrg}','jane@savvi.law','admin')`); } catch { threw = true; }
ok(threw, 'admin cannot promote counsel to admin');

// ── Compliance calendar ──
// Fresh fund so dates are predictable.
const f3 = (await db.query(`insert into funds (organization_id,name,target_size,min_commitment,status) values ('${vcgOrg}','Fund III',1000000,50000,'raising') returning id`)).rows[0].id;
const ncInv = (await db.query(`insert into investors (organization_id,display_name,email,accreditation_status,home_state) values ('${vcgOrg}','NC Investor','nc@real.com','verified','NC') returning id`)).rows[0].id;
const alInv = (await db.query(`insert into investors (organization_id,display_name,email,accreditation_status,home_state) values ('${vcgOrg}','AL Investor','al@real.com','verified','AL') returning id`)).rows[0].id;
const nc2 = (await db.query(`insert into investors (organization_id,display_name,email,accreditation_status,home_state) values ('${vcgOrg}','NC Two','nc2@real.com','verified','NC') returning id`)).rows[0].id;
const noState = (await db.query(`insert into investors (organization_id,display_name,email,accreditation_status) values ('${vcgOrg}','Mystery','m@real.com','verified') returning id`)).rows[0].id;

// 2026-10-01 is a Thursday; +15 = Fri 10/16. 2026-10-03 (Sat) +15 = Sun 10/18 -> Mon 10/19.
await as(owner, `insert into commitments (organization_id,fund_id,investor_id,amount,status,signed_at) values ('${vcgOrg}','${f3}','${ncInv}',50000,'accepted','2026-10-01')`, 'aal2');
let items = (await as(owner, `select kind, state, due_date::text d from compliance_items where fund_id='${f3}' order by kind, state`)).rows;
ok(items.length === 2 && items.find(i => i.kind === 'form_d_initial').d === '2026-10-16', 'first acceptance creates Form D due first sale + 15 days');
ok(items.find(i => i.kind === 'state_notice' && i.state === 'NC'), 'first NC investor creates NC notice reminder');
await as(owner, `insert into commitments (organization_id,fund_id,investor_id,amount,status,signed_at) values ('${vcgOrg}','${f3}','${nc2}',50000,'accepted','2026-10-05')`, 'aal2');
await as(owner, `insert into commitments (organization_id,fund_id,investor_id,amount,status,signed_at) values ('${vcgOrg}','${f3}','${alInv}',50000,'accepted','2026-10-03')`, 'aal2');
items = (await as(owner, `select kind, state, due_date::text d from compliance_items where fund_id='${f3}'`)).rows;
ok(items.filter(i => i.kind === 'form_d_initial').length === 1, 'Form D created only once');
ok(items.filter(i => i.state === 'NC').length === 1, 'second NC investor adds no duplicate');
ok(items.find(i => i.state === 'AL').d === '2026-10-19', 'weekend due date moves to Monday');
await as(owner, `insert into commitments (organization_id,fund_id,investor_id,amount,status,signed_at) values ('${vcgOrg}','${f3}','${noState}',50000,'accepted','2026-10-06')`, 'aal2');
ok((await db.query(`select count(*)::int n from compliance_items where fund_id='${f3}' and state='??'`)).rows[0].n === 1, 'unknown state creates a fix-me item');
await as(owner, `insert into commitments (organization_id,fund_id,investor_id,amount,status) values ('${vcgOrg}','${f3}','${noState}',50000,'pending')`, 'aal2');
ok((await db.query(`select count(*)::int n from compliance_items where fund_id='${f3}'`)).rows[0].n === 4, 'pending commitments create nothing');

const fd = (await db.query(`select id from compliance_items where fund_id='${f3}' and kind='form_d_initial'`)).rows[0].id;
await as(ir, `update compliance_items set status='done', completed_on='2026-10-14', reference='0001234567-26-000001' where id='${fd}'`);
const amend = (await db.query(`select due_date::text d from compliance_items where fund_id='${f3}' and kind='form_d_amendment'`)).rows;
ok(amend.length === 1 && amend[0].d === '2027-10-14', 'filing Form D schedules the annual amendment');
ok((await as(lpA, `select * from compliance_items`)).rows.length === 0, 'investors cannot see compliance items');
ok((await as(cns, `select * from compliance_items`)).rows.length === 0, 'counsel role does not see the calendar (staff only)');
threw = false; try { await as(owner, `delete from compliance_items where id='${fd}'`); } catch { threw = true; }
ok((await db.query(`select count(*)::int n from compliance_items where id='${fd}'`)).rows[0].n === 1, 'auto-generated items cannot be deleted');

// ── Document tracking ──
const ppmDoc = (await db.query(`select id from documents where title='PPM' limit 1`)).rows[0].id;
const ncUser = '99999999-9999-9999-9999-999999999999';
await db.exec(`insert into auth.users (id,email) values ('${ncUser}','nc@real.com')`);
await as(owner, `select link_portal_user('${ncInv}','nc@real.com')`, 'aal2');
await db.exec(`insert into document_access_log (organization_id,document_id,user_id) values ('${vcgOrg}','${ppmDoc}','${ncUser}'),('${vcgOrg}','${ppmDoc}','${ncUser}')`);
const opens = (await as(ir, `select investor_name, opens from document_opens where document_id='${ppmDoc}'`)).rows;
ok(opens.length === 1 && opens[0].opens === 2 && opens[0].investor_name === 'NC Investor', 'per-investor open counts');
ok((await as(ncUser, `select * from document_opens`)).rows.length === 0, 'investors cannot see who opened what');
