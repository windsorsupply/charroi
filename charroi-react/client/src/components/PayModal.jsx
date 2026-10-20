// Fenêtre de paiement : champ de carte sécurisé de Stripe (Payment Element),
// ou bouton de paiement simulé quand le serveur tourne sans clé Stripe (développement).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Capacitor } from '@capacitor/core';
import { useStore } from '../store.jsx';
import { api } from '../lib/api.js';

const PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
let stripeP = null;
const getStripe = () => (stripeP ||= PK ? loadStripe(PK, { locale: 'auto' }) : Promise.resolve(null));

// Attend que le serveur ait reçu la confirmation de Stripe (livraison / réservation créée).
async function waitPayment(paymentId, ms = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await api.act('paymentStatus', { paymentId }).catch(() => null);
    if (r && r.status !== 'PENDING') return r;
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  return null;
}

function StripeForm({ onPaid, label, setErr }) {
  const stripe = useStripe(), elements = useElements();
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setErr('');
    const { error } = await stripe.confirmPayment({
      elements, redirect: 'if_required',
      confirmParams: { return_url: Capacitor.isNativePlatform() ? 'charroi://payment-return' : window.location.href },
    });
    if (error) { setErr(error.message); setBusy(false); return; }
    onPaid();
  };
  return <><PaymentElement options={{ layout: 'tabs' }} /><div className="actions"><button className="btn amber" disabled={!stripe || busy} onClick={pay}>{label}</button></div></>;
}

export default function PayModal({ summary, intent, kind, amount }) {
  const { t, tf, money, lang, closeModal, refresh, toast, errMsg, dark } = useStore();
  const nav = useNavigate();
  const [st, setSt] = useState({ phase: 'loading' });
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    intent().then((r) => live && setSt({ phase: 'ready', ...r })).catch((e) => live && setSt({ phase: 'error', msg: errMsg(e) }));
    return () => { live = false; };
  }, []);

  const finish = async (paymentId) => {
    setSt((s) => ({ ...s, phase: 'processing' }));
    const r = await waitPayment(paymentId);
    await refresh().catch(() => {});
    closeModal();
    if (r && r.status !== 'FAILED') { toast(kind === 'booking' ? tf('bookedMsg', { id: r.refId }) : t('paid')); nav(`/${kind}/${r.refId}`); }
    else toast(r ? t('offerGone') : t('payTimeout'));
  };

  const total = st.amount != null ? st.amount : amount;
  if (st.phase === 'processing') return <div className="idvwait"><div className="spin" aria-hidden="true" /><h2>{t('payProcessing')}</h2></div>;
  return (
    <>
      <h2>{t('payT')}</h2>
      {summary}
      <div id="payEl">
        {st.phase === 'loading' && <p className="paywait"><span className="spin" style={{ width: 22, height: 22, borderWidth: 3, margin: 0 }} aria-hidden="true" />{t('payLoading')}</p>}
        {st.phase === 'error' && <p className="err">{st.msg}</p>}
        {st.phase === 'ready' && st.simulated && <>
          <div className="simpay"><b>🧪 {t('simPayT')}</b><p style={{ margin: '4px 0 0' }}>{t('simPayD')}</p></div>
          <div className="actions"><button className="btn amber" onClick={async () => {
            try { await api.act('simulatePay', { paymentId: st.paymentId }); finish(st.paymentId); } catch (e) { setErr(errMsg(e)); }
          }}>{tf('payBtn', { t: money(total) })}</button></div>
        </>}
        {st.phase === 'ready' && !st.simulated && st.clientSecret && (
          <Elements stripe={getStripe()} options={{ clientSecret: st.clientSecret, locale: lang === 'en' ? 'en-CA' : 'fr-CA', appearance: { theme: dark ? 'night' : 'stripe', variables: { colorPrimary: dark ? '#1E9658' : '#11804A', fontFamily: 'Barlow, Arial, sans-serif', borderRadius: '6px' } } }}>
            <StripeForm label={tf('payBtn', { t: money(total) })} setErr={setErr} onPaid={() => finish(st.paymentId)} />
          </Elements>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>🔒 {t('paySecure')}</p>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="actions"><button className="btn ghost" onClick={closeModal}>{t('cancel')}</button></div>
    </>
  );
}
