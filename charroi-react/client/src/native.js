// Fonctions natives (iOS / Android via Capacitor) : notifications push, liens profonds
// (retour de Stripe), bouton Retour d’Android, barre d’état. Sans effet dans un navigateur.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useStore } from './store.jsx';
import { api } from './lib/api.js';

export const native = Capacitor.isNativePlatform();

// Ouvre une page externe (Stripe) : navigateur intégré dans l’app, ou même onglet sur le web.
export async function openExternal(url) {
  if (native) await Browser.open({ url, presentationStyle: 'popover' });
  else window.location.href = url;
}

async function registerPush(nav) {
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    const perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== 'granted') return;
    const { token } = await FirebaseMessaging.getToken();
    if (token) await api.pushToken({ token, platform: Capacitor.getPlatform() });
    if (Capacitor.getPlatform() === 'android') await FirebaseMessaging.createChannel({ id: 'charroi', name: 'Charroi', importance: 4 }).catch(() => {});
    FirebaseMessaging.addListener('notificationActionPerformed', (e) => {
      const link = e.notification?.data?.link;
      if (link && link.startsWith('#/')) nav(link.slice(1));
    });
  } catch (e) { console.warn('push', e); }
}

export function useNative() {
  const nav = useNavigate();
  const { S, closeModal, modal, dark } = useStore();
  const userId = S.me && S.me.role !== 'guest' ? S.me.id : null;

  useEffect(() => {
    if (!native) return;
    setTimeout(() => SplashScreen.hide().catch(() => {}), 150);
    const subs = [
      App.addListener('appUrlOpen', async ({ url }) => {
        try {
          const u = new URL(url);
          if (u.host === 'stripe-return' || u.pathname.includes('stripe-return')) {
            await Browser.close().catch(() => {});
            nav(`/stripe-return/${u.searchParams.get('r') || ''}`);
          }
        } catch (_) { /* lien inconnu */ }
      }),
    ];
    return () => subs.forEach((p) => p.then((s) => s.remove()));
  }, []);

  // Barre d’état (heure, batterie) lisible sur le thème clair comme sombre.
  useEffect(() => {
    if (!native) return;
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
    if (Capacitor.getPlatform() === 'android') StatusBar.setBackgroundColor({ color: dark ? '#171C19' : '#FFFFFF' }).catch(() => {});
  }, [dark]);

  // Bouton Retour d’Android : ferme la fenêtre ouverte, sinon revient en arrière.
  useEffect(() => {
    if (!native) return;
    const p = App.addListener('backButton', ({ canGoBack }) => {
      if (modal) closeModal();
      else if (canGoBack && window.location.hash !== '#/home') window.history.back();
      else App.exitApp();
    });
    return () => { p.then((s) => s.remove()); };
  }, [modal]);

  useEffect(() => { if (native && userId) registerPush(nav); }, [userId]);
}
