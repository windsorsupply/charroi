-- =====================================================================
-- Charroi : schéma PostgreSQL
-- Les règles métier sont dans server/src/services ; la base garantit
-- l’intégrité (clés, contraintes, aucune double réservation).
-- Montants : toujours en cents (CAD).
-- =====================================================================

create extension if not exists btree_gist;

create table settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null
);

-- ---------- Comptes et profils ----------
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique,                      -- null pour un invité
  password_hash text,
  role text not null default 'client' check (role in ('client','carrier','admin','guest')),
  name text not null default '',
  company text not null default '',
  city text not null default '',
  region text not null default '',
  photo text,
  lang text not null default 'fr' check (lang in ('fr','en')),
  phone text,
  address text,
  postal text,
  kind text,
  ship_volume text,
  -- transporteur
  vehicle text,
  trailer text not null default 'none',
  capacity numeric not null default 0,
  exp int not null default 0,
  verified boolean not null default false,
  rejected boolean not null default false,
  deliveries int not null default 0,
  rating_sum int not null default 0,
  rating_n int not null default 0,
  descr jsonb,
  regions text[] not null default '{}',
  veh jsonb,
  tax_reg boolean not null default false,
  neq text,
  status text,
  ins jsonb,
  lic_class text,
  nir text,
  tps text,
  tvq text,
  docs jsonb not null default '{}',
  idv jsonb,
  marketing boolean not null default false,
  stripe_account_id text,
  stripe_customer_id text,
  terms_at timestamptz,
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table password_resets (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null
);

-- ---------- Cargaisons ----------
create sequence cargo_seq start 1001;
create table cargos (
  id text primary key default ('CG-' || nextval('cargo_seq')),
  client_id uuid not null references users(id),
  status text not null default 'PUBLISHED'
    check (status in ('PUBLISHED','OFFERS_RECEIVED','TRANSPORTER_SELECTED','CLOSED','CANCELLED')),
  created_at timestamptz not null default now(),
  from_city text not null, from_date date not null, from_time text not null default '',
  from_address text not null default '', from_postal text not null default '', from_notes text not null default '',
  to_city text not null, to_date date not null, to_time text not null default '',
  to_address text not null default '', to_postal text not null default '', to_notes text not null default '',
  goods jsonb not null,
  transport jsonb not null,
  special boolean not null default false,
  budget int,
  km int not null default 0,
  offers_pending int not null default 0
);
create index on cargos (status);
create index on cargos (client_id);

-- ---------- Offres ----------
create table offers (
  id text primary key default ('OF-' || substr(md5(gen_random_uuid()::text), 1, 8)),
  cargo_id text not null references cargos(id) on delete cascade,
  carrier_id uuid not null references users(id),
  price int not null check (price > 0),
  avail_date date not null,
  hours numeric not null default 1,
  comment text not null default '',
  vehicle text not null,
  trailer text not null default 'none',
  status text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','REJECTED','WITHDRAWN')),
  at timestamptz not null default now()
);
create index on offers (cargo_id);
create index on offers (carrier_id);
create unique index offers_one_active on offers (cargo_id, carrier_id) where status in ('PENDING','ACCEPTED');

-- ---------- Paiements ----------
create sequence pay_seq;
create table payments (
  id text primary key default ('PAY-' || lpad(nextval('pay_seq')::text, 6, '0')),
  kind text not null check (kind in ('transport','rental')),
  ref_id text not null,
  user_id uuid not null references users(id),
  amount int not null,
  b jsonb not null,
  status text not null default 'PENDING'
    check (status in ('PENDING','FAILED','CAPTURED','PAID','RELEASED','REFUNDED','PARTIALLY_REFUNDED')),
  refunded int not null default 0,
  extra int not null default 0,
  at timestamptz not null default now(),
  events jsonb not null default '[]',
  payload jsonb,
  stripe_pi text unique,
  stripe_deposit_pi text,
  stripe_transfer text,
  stripe_pm text
);
create index on payments (user_id);

-- ---------- Livraisons ----------
create sequence deliv_seq;
create table deliveries (
  id text primary key,
  cargo_id text not null references cargos(id),
  offer_id text not null references offers(id),
  client_id uuid not null references users(id),
  carrier_id uuid not null references users(id),
  price int not null,
  status text not null default 'SCHEDULED'
    check (status in ('SCHEDULED','PICKED_UP','IN_TRANSIT','DELIVERED','CONFIRMED','COMPLETED','DISPUTED','CANCELLED')),
  payment_id text not null references payments(id),
  conv_id text,
  created_at timestamptz not null default now(),
  history jsonb not null default '[]',
  proof jsonb,
  pickup_date date,
  delivered_at timestamptz
);
create unique index deliveries_one_per_cargo on deliveries (cargo_id) where status <> 'CANCELLED';
create index on deliveries (client_id);
create index on deliveries (carrier_id);

-- ---------- Litiges ----------
create sequence dispute_seq;
create table disputes (
  id text primary key default ('LIT-' || lpad(nextval('dispute_seq')::text, 4, '0')),
  delivery_id text not null references deliveries(id),
  reason text not null,
  descr text not null,
  photos text[] not null default '{}',
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  resolution text,
  info boolean not null default false,
  at timestamptz not null default now()
);

-- ---------- Évaluations ----------
create table reviews (
  id text primary key default ('RV-' || substr(md5(gen_random_uuid()::text), 1, 10)),
  kind text not null check (kind in ('delivery','rental')),
  ref_id text not null,
  from_id uuid not null references users(id),
  from_name text not null default '',
  to_id text not null,
  stars int not null check (stars between 1 and 5),
  text text not null default '',
  at timestamptz not null default now(),
  unique (ref_id, from_id)
);

-- ---------- Remorques ----------
create sequence trailer_seq;
create table trailers (
  id text primary key default ('T-' || lpad(nextval('trailer_seq')::text, 3, '0')),
  no text not null,
  name jsonb not null,
  brand text not null default '',
  model text not null default '',
  year int not null,
  type text not null check (type in ('open','enclosed','flat','dump')),
  lf numeric not null default 0,
  wf numeric not null default 0,
  cap numeric not null default 0,
  wt numeric not null default 0,
  hitch text not null default '',
  day int not null,
  week int not null,
  month int not null,
  deposit int not null default 0,
  descr jsonb,
  cond jsonb,
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE','MAINTENANCE','UNAVAILABLE')),
  photos text[] not null default '{}'
);

-- ---------- Réservations ----------
create sequence rent_seq;
create table bookings (
  id text primary key,
  trailer_id text not null references trailers(id),
  client_id uuid not null references users(id),
  start_date date not null,
  end_date date not null check (end_date > start_date),
  days int not null,
  price int not null,
  tps int not null,
  tvq int not null,
  total int not null,
  deposit int not null,
  dep_mode text not null check (dep_mode in ('auth','capture')),
  charge_now int not null,
  status text not null default 'PENDING' check (status in ('PENDING','CONFIRMED','ACTIVE','COMPLETED','CANCELLED')),
  payment_id text references payments(id),
  conv_id text,
  insp jsonb not null default '{}',
  renter jsonb,
  at timestamptz not null default now(),
  -- Une seule réservation possible pour une remorque à des dates qui se chevauchent.
  constraint bookings_no_overlap exclude using gist (
    trailer_id with =, daterange(start_date, end_date) with &&
  ) where (status in ('PENDING','CONFIRMED','ACTIVE'))
);
create index on bookings (client_id);

-- ---------- Messagerie ----------
create table convs (
  id text primary key default ('CV-' || substr(md5(gen_random_uuid()::text), 1, 10)),
  kind text not null check (kind in ('transport','rental','pre')),
  ref_id text not null,
  members text[] not null,                 -- uuid des membres, ou 'admin'
  seen jsonb not null default '{}',
  last_at timestamptz not null default now()
);

create table messages (
  id bigint generated always as identity primary key,
  conv_id text not null references convs(id) on delete cascade,
  from_id text not null,
  text text not null check (length(text) between 1 and 4000),
  sys boolean not null default false,
  at timestamptz not null default now()
);
create index on messages (conv_id, at);

-- ---------- Notifications ----------
create table notifications (
  id bigint generated always as identity primary key,
  to_id text not null,                     -- uuid, ou 'admin'
  key text not null,
  vars jsonb not null default '{}',
  link text,
  at timestamptz not null default now(),
  read boolean not null default false
);
create index on notifications (to_id, at desc);

create table push_tokens (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  platform text not null,
  updated_at timestamptz not null default now()
);

-- ---------- Fichiers envoyés (photos, preuves, documents) ----------
create table files (
  id text primary key,                     -- nom unique du fichier
  owner_id uuid not null references users(id),
  private boolean not null default false,
  scope text not null default 'pub' check (scope in ('pub','shared','docs')),
  mime text not null default 'image/jpeg',
  size int not null default 0,
  at timestamptz not null default now()
);
