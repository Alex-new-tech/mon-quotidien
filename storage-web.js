// ===== Stockage web : synchro cloud (Supabase) + cache local hors-ligne =====
// En Electron, window.api existe déjà (preload, fichier local) → on n'y touche pas.
if (!window.api) {
  const LS_KEY = 'mon-quotidien-state';

  // Repli "100% local" si le cloud n'est pas configuré/chargé.
  const localOnly = {
    load: async () => {
      try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
    },
    save: async (data) => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(data)); return true; } catch { return false; }
    },
  };

  if (window.MQ_CONFIG && window.MQ_CONFIG.supabaseUrl && window.supabase) {
    const sb = window.supabase.createClient(window.MQ_CONFIG.supabaseUrl, window.MQ_CONFIG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    window.mqSupabase = sb; // utilisé par auth.js

    window.api = {
      load: async () => {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return localOnly.load(); // pas connecté → cache local
        const { data, error } = await sb
          .from('app_state').select('data').eq('user_id', session.user.id).maybeSingle();
        if (error) { console.error('Lecture cloud échouée :', error.message); return localOnly.load(); }
        // 1re connexion sans ligne cloud : on récupère le cache local s'il existe.
        const state = data ? data.data : await localOnly.load();
        if (state) localStorage.setItem(LS_KEY, JSON.stringify(state));
        return state;
      },
      save: async (data) => {
        localStorage.setItem(LS_KEY, JSON.stringify(data)); // cache immédiat (hors-ligne)
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return false;
        const { error } = await sb.from('app_state')
          .upsert({ user_id: session.user.id, data, updated_at: new Date().toISOString() });
        if (error) console.error('Sync cloud échouée :', error.message);
        return !error;
      },
    };
  } else {
    window.api = localOnly;
  }
}
