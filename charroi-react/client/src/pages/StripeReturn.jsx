// Retour de Stripe Connect ou Stripe Identity : met à jour le statut puis revient à la page d’origine.
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { api } from '../lib/api.js';
import { native, openExternal } from '../native.js';

export default function StripeReturn() {
  const { r = '' } = useParams();
  const { t, refresh } = useStore();
  const nav = useNavigate();
  useEffect(() => {
    (async () => {
      try {
        if (r === 'connect-refresh') {
          // Lien Stripe expiré : on en demande un nouveau.
          const x = await api.act('connectOnboard', { web: !native });
          return openExternal(x.url);
        }
        if (r === 'connect') await api.act('connectStatus');
        if (r === 'identity') await api.act('identityStatus');
        await refresh();
      } catch (e) { console.warn(e); }
      let back = null;
      try { back = localStorage.getItem('charroi-back'); localStorage.removeItem('charroi-back'); } catch (_) { /* ignoré */ }
      nav(back || '/dash/docs', { replace: true });
    })();
  }, [r]);
  return <div className="empty"><p>{t('stripeBack')}</p></div>;
}
