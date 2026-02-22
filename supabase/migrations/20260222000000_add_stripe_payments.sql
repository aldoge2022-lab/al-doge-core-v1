create extension if not exists pgcrypto;

create table if not exists public.stripe_payments (
  id uuid primary key default gen_random_uuid(),
  payment_intent text unique not null,
  session_id uuid not null,
  amount_cents integer not null,
  created_at timestamptz default now()
);
