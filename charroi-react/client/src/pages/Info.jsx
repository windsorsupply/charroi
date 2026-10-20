// Aide, conditions d’utilisation, politique de confidentialité.
// Les textes légaux et les coordonnées sont saisis par l’admin (Administration › Paramètres).
import { useStore } from '../store.jsx';

// Texte publié par l’admin, dans la langue affichée (repli sur l’autre langue).
const pick = (S, lang, fr, en) => (lang === 'en' ? S.settings[en] || S.settings[fr] : S.settings[fr] || S.settings[en]) || '';
const Paras = ({ text }) => text.split(/\n{2,}/).map((p, i) => <p key={i} style={{ whiteSpace: 'pre-line' }}>{p}</p>);

function Contact() {
  const { S, t } = useStore();
  const c = [S.settings.supportPhone, S.settings.supportEmail].filter(Boolean);
  if (!c.length) return null;
  return <p className="small muted" style={{ marginTop: 16 }}>{t('contactUs')} : {S.settings.supportEmail ? <a href={`mailto:${S.settings.supportEmail}`}>{S.settings.supportEmail}</a> : null}{c.length > 1 ? ' · ' : ''}{S.settings.supportPhone}</p>;
}

export function Help() {
  const { t, tf, S } = useStore();
  return <div className="prose"><h1 className="pt">{t('helpT')}</h1>
    {[1, 2, 3, 4, 5, 6].map((i) => <details key={i} open={i === 1}><summary>{t(`faq${i}q`)}</summary>
      <p style={{ marginTop: 8 }}>{tf(`faq${i}a`, { h: S.settings.autoConfirmH, r: S.settings.commission, d: S.settings.depositAuthMaxDays })}</p></details>)}
    <Contact />
  </div>;
}

export function Terms() {
  const { t, S, lang } = useStore();
  const text = pick(S, lang, 'termsFr', 'termsEn');
  return <div className="prose"><h1 className="pt">{t('termsT')}</h1>{text ? <Paras text={text} /> : <p className="muted">{t('termsBody')}</p>}<Contact /></div>;
}

export function Privacy() {
  const { t, tf, S, lang } = useStore();
  const text = pick(S, lang, 'privacyFr', 'privacyEn');
  return <div className="prose"><h1 className="pt">{t('privacyT')}</h1>
    {text ? <Paras text={text} /> : <p className="muted">{t('privacyBody')}</p>}
    {S.settings.privacyOfficer && <p><b>{tf('privacyOfficer', { o: S.settings.privacyOfficer })}</b></p>}
    <Contact />
  </div>;
}
