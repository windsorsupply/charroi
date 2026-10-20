// Courriels bilingues (langue choisie par la personne). Sans SMTP configuré,
// le courriel est affiché dans la console (pratique en développement).
import nodemailer from 'nodemailer';
import { config } from './config.js';

const T = {
  reset: {
    fr: { subject: 'Réinitialisez votre mot de passe Charroi', title: 'Nouveau mot de passe', body: 'Vous avez demandé à changer votre mot de passe Charroi. Le lien est valide pendant une heure.', btn: 'Choisir un mot de passe' },
    en: { subject: 'Reset your Charroi password', title: 'New password', body: 'You asked to change your Charroi password. The link is valid for one hour.', btn: 'Choose a password' },
  },
  booking: {
    fr: { subject: 'Réservation confirmée : {id}', title: 'Réservation confirmée', body: 'Votre réservation {id} est confirmée : {t}, du {a} au {b}. Apportez votre permis de conduire et une preuve d’assurance.', btn: 'Voir ma réservation' },
    en: { subject: 'Booking confirmed: {id}', title: 'Booking confirmed', body: 'Your booking {id} is confirmed: {t}, from {a} to {b}. Bring your driver’s licence and proof of insurance.', btn: 'View my booking' },
  },
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : ''));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let transport = null;
export async function sendMail(to, lang, kind, vars) {
  const t = T[kind][lang === 'en' ? 'en' : 'fr'];
  const link = vars.link || config.appUrl;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#181918">
<p style="font-size:22px;font-weight:bold;margin:0 0 16px"><span style="display:inline-block;width:26px;height:18px;border-radius:3px;background:#159A59;vertical-align:-2px"></span> Charroi</p>
<h2 style="margin:0 0 12px">${esc(fill(t.title, vars))}</h2><p>${esc(fill(t.body, vars))}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#11804A;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">${esc(t.btn)}</a></p>
<p style="color:#5C615E;font-size:13px">${lang === 'en' ? 'If you didn’t ask for this, you can ignore this email.' : 'Si vous n’avez rien demandé, ignorez ce courriel.'}</p></div>`;
  const msg = { from: config.mailFrom, to, subject: fill(t.subject, vars), html, text: `${fill(t.body, vars)}\n\n${link}` };
  if (!config.smtp) { console.log(`✉  [courriel non envoyé : SMTP absent] À ${to} — ${msg.subject}\n   ${link}`); return; }
  transport ||= nodemailer.createTransport(config.smtp);
  await transport.sendMail(msg);
}
