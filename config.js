// ===== Configuration cloud (Supabase) =====
// La clé "publishable" est PUBLIQUE par conception (protégée par les règles RLS
// côté base). Elle peut donc vivre dans le navigateur et dans le dépôt sans risque.
// (Ne JAMAIS mettre ici une clé "secret" / service_role.)
window.MQ_CONFIG = {
  supabaseUrl: 'https://djyfsbkedtngwpxfloel.supabase.co',
  supabaseKey: 'sb_publishable_GSTS9p9e7rrb3W1uBxcQQA_FLBC4zYw',
};
