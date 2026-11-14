-- Accountant / CPA role. Own file: the new enum value must be committed before 0013 uses it.
alter type member_role add value if not exists 'accountant';
