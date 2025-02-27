const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

// Create a new Supabase client using the URL and key provided in the configuration.
const supabase = createClient(config.supabaseUrl, config.supabaseKey);

module.exports = supabase;
