const supabase = require('./_supabase');

let cachedMenu = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 60 secondi

exports.handler = async () => {
  const now = Date.now();

  // Serve cache se valida
  if (cachedMenu && (now - cacheTimestamp) < CACHE_TTL) {
    console.log('api-menu: served from cache');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cachedMenu)
    };
  }

  const start = Date.now();

  const { data, error } = await supabase
    .from('menu_items')
    .select('id, nome, categoria, prezzo_cents, ingredienti')
    .eq('disponibile', true);

  const duration = Date.now() - start;
  console.log('api-menu: db duration', duration, 'ms');

  if (error) {
    console.error('api-menu error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }

  cachedMenu = data;
  cacheTimestamp = now;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
};
