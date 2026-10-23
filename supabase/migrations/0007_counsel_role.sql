-- Outside counsel role. Kept in its own file: Postgres requires a new enum value
-- to be committed before other statements use it. Run this, then 0008.
alter type member_role add value if not exists 'counsel';
