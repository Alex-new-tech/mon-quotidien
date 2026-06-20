// ===== Connexion par e-mail — code à 6 chiffres (Supabase OTP) =====
// Nécessite un SMTP personnalisé (ex. Resend) côté Supabase pour que l'e-mail
// affiche le code {{ .Token }}. En Electron, mqSupabase n'existe pas -> pas de connexion.
(async () => {
  const sb = window.mqSupabase;
  const overlay = document.getElementById('auth-overlay');
  const logoutBtn = document.getElementById('logout-btn');
  if (!sb || !overlay) return;

  const { data: { session } } = await sb.auth.getSession();

  if (session) {
    if (logoutBtn) {
      logoutBtn.classList.remove('hidden');
      logoutBtn.title = 'Déconnexion (' + (session.user.email || '') + ')';
      logoutBtn.onclick = async () => { await sb.auth.signOut(); location.reload(); };
    }
    return;
  }

  overlay.classList.remove('hidden');
  const emailStep = document.getElementById('auth-step-email');
  const codeStep = document.getElementById('auth-step-code');
  const emailInput = document.getElementById('auth-email');
  const codeInput = document.getElementById('auth-code');
  const msg = document.getElementById('auth-msg');

  const sendCode = async () => {
    const email = emailInput.value.trim();
    if (!email) { msg.textContent = 'Entre ton adresse e-mail.'; return; }
    msg.textContent = 'Envoi du code…';
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) { msg.textContent = 'Erreur : ' + error.message; return; }
    emailStep.classList.add('hidden');
    codeStep.classList.remove('hidden');
    msg.textContent = 'Code envoyé à ' + email + '. Regarde tes e-mails (et les spams).';
    codeInput.focus();
  };

  const verifyCode = async () => {
    const email = emailInput.value.trim();
    const token = codeInput.value.trim();
    if (!token) { msg.textContent = 'Entre le code reçu par e-mail.'; return; }
    msg.textContent = 'Vérification…';
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) { msg.textContent = 'Code invalide : ' + error.message; return; }
    location.reload(); // session active -> l'app se charge avec tes données synchronisées
  };

  document.getElementById('auth-send').onclick = sendCode;
  document.getElementById('auth-verify').onclick = verifyCode;
  document.getElementById('auth-back').onclick = () => {
    codeStep.classList.add('hidden');
    emailStep.classList.remove('hidden');
    msg.textContent = '';
  };
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCode(); });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyCode(); });
})();
