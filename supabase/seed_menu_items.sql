insert into public.menu_items (nome, categoria, prezzo, ingredienti, allergeni, tag, varianti, promozioni, disponibile)
values
  (
    'Pizza Margherita',
    'pizza',
    7.00,
    '["pomodoro","mozzarella","basilico"]'::jsonb,
    '["glutine","lattosio"]'::jsonb,
    '["classica","vegetariana"]'::jsonb,
    '{"impasto":["normale","kamut"],"extra":["burrata"]}'::jsonb,
    '{}'::jsonb,
    true
  ),
  (
    'Pizza Diavola',
    'pizza',
    8.50,
    '["pomodoro","mozzarella","salame piccante"]'::jsonb,
    '["glutine","lattosio"]'::jsonb,
    '["forte","classica"]'::jsonb,
    '{"impasto":["normale","kamut"],"extra":["burrata"]}'::jsonb,
    '{}'::jsonb,
    true
  );
