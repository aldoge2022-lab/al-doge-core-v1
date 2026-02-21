const { createClient } = require('@supabase/supabase-js');

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  : {
    from: () => {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    }
  };

module.exports = supabase;
