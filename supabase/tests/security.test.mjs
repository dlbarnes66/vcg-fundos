import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
const root = process.argv[2] ?? fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite();
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('pass:', m); };

await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
`);
await db.exec(readFileSync(`${root}/supabase/migrations/0001_init.sql`, 'utf8'));
await db.exec(readFileSync(`${root}/supabase/seed.sql`, 'utf8'));

const owner = '11111111-1111-1111-1111-111111111111';
const lpA = '22222222-2222-2222-2222-222222222222';
const other = '33333333-3333-3333-3333-333333333333';
await db.exec(`insert into auth.users values ('${owner}','owner@x.com'),('${lpA}','a@example.com'),('${other}','other@y.com');`);
await db.exec(`select bootstrap_owner('owner@x.com'); select seed_demo('vcg');`);
await db.exec(`select bootstrap_owner('other@y.com','Other Co','other');`);
await db.exec(`
  insert into memberships select o.id, '${lpA}', 'investor' from organizations o where slug='vcg';
  update investors set portal_user_id='${lpA}' where email='a@example.com';
`);
await db.exec(`grant usage on schema public, auth, storage to authenticated;
  grant all on all tables in schema public to authenticated; grant all on all tables in schema storage to authenticated;
  grant usage, select on all sequences in schema public to authenticated;`);

async function as(uid, sql) {
  await db.exec(`set role authenticated; set test.uid = '${uid}';`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; set test.uid = '';`); }
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
await db.exec(`insert into auth.users values ('${lpE}','e@example.com')`);
const invE = (await db.query(`select id from investors where email='e@example.com'`)).rows[0].id;
threw = false;
try { await as(lpA, `select link_portal_user('${invE}','e@example.com')`); } catch { threw = true; }
ok(threw, 'LP cannot grant portal access');
await as(owner, `select link_portal_user('${invE}','e@example.com')`);
ok((await as(lpE, 'select * from investors')).rows.length === 1, 'linked LP sees own record');
threw = false;
try { await as(owner, `select link_portal_user('${invE}','owner@x.com')`); } catch { threw = true; }
ok(threw, 'cannot link a staff login as an investor');
