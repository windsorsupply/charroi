// Accueil : trois choix (expédier, transporter, louer), carte, fonctionnement.
import { Link } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { RouteMap } from '../components/ui.jsx';

export default function Home() {
  const { t } = useStore();
  const choice = (to, ic, k, primary) => (
    <Link className={`choice${primary ? ' primary' : ''}`} to={to}>
      <span className="ic" aria-hidden="true">{ic}</span><h2>{t(k + 't')}</h2><p>{t(k + 'd')}</p><span className="go">{t(k + 'a')} →</span>
    </Link>
  );
  return <>
    <section className="cta"><h1>{t('heroTitle')}</h1><p className="lead">{t('ctaSub')}</p>
      <div className="choices">{choice('/publish', '🚚', 'c1', true)}{choice('/loads', '🚛', 'c2')}{choice('/trailers', '🛻', 'c3')}</div>
    </section>
    <section className="hero"><div><h2>{t('mapT')}</h2><p className="lead">{t('heroSub')}</p></div><div><RouteMap a="Montréal" b="Québec" anim /></div></section>
    <section className="how" id="how">
      <div><h2>{t('howTr')}</h2><ol>{['ht1', 'ht2', 'ht3', 'ht4', 'ht5'].map((k) => <li key={k}><span>{t(k)}</span></li>)}</ol></div>
      <div><h2>{t('howRe')}</h2><ol>{['hr1', 'hr2', 'hr3', 'hr4'].map((k) => <li key={k}><span>{t(k)}</span></li>)}</ol></div>
    </section>
    <section className="trust">{[1, 2, 3].map((i) => <div key={i}><b>{t(`trust${i}t`)}</b><span className="muted">{t(`trust${i}d`)}</span></div>)}</section>
  </>;
}
