do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'menu_items'
      and column_name = 'name'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'menu_items'
      and column_name = 'nome'
  ) then
    alter table public.menu_items rename column name to nome;
  end if;
end
$$;

alter table public.menu_items
  add column if not exists ingredienti jsonb default '[]'::jsonb,
  add column if not exists allergeni jsonb default '[]'::jsonb,
  add column if not exists tag jsonb default '[]'::jsonb,
  add column if not exists varianti jsonb default '{}'::jsonb,
  add column if not exists promozioni jsonb default '{}'::jsonb,
  add column if not exists disponibile boolean default true;

do $$
declare
  id_data_type text;
  nome_data_type text;
  categoria_data_type text;
  prezzo_data_type text;
  disponibile_data_type text;
begin
  select data_type into id_data_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'menu_items'
    and column_name = 'id';

  if id_data_type is not null and id_data_type <> 'uuid' then
    alter table public.menu_items
      alter column id type uuid using id::uuid;
  end if;

  select data_type into nome_data_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'menu_items'
    and column_name = 'nome';

  if nome_data_type is not null and nome_data_type <> 'text' then
    alter table public.menu_items
      alter column nome type text using nome::text;
  end if;

  select data_type into categoria_data_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'menu_items'
    and column_name = 'categoria';

  if categoria_data_type is not null and categoria_data_type <> 'text' then
    alter table public.menu_items
      alter column categoria type text using categoria::text;
  end if;

  select data_type into prezzo_data_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'menu_items'
    and column_name = 'prezzo';

  if prezzo_data_type is not null and prezzo_data_type not in ('numeric', 'real', 'double precision') then
    alter table public.menu_items
      alter column prezzo type numeric using prezzo::numeric;
  end if;

  select data_type into disponibile_data_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'menu_items'
    and column_name = 'disponibile';

  if disponibile_data_type is not null and disponibile_data_type <> 'boolean' then
    alter table public.menu_items
      alter column disponibile type boolean using disponibile::boolean;
  end if;
end
$$;
