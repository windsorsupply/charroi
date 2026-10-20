// Configure les projets natifs après « npx cap add android » et/ou « npx cap add ios ».
// Usage : node scripts/native-setup.mjs
// Ajoute : lien profond charroi:// (retour de courriel et de Stripe), permissions
// caméra / photos / position, notifications push (Firebase). Sans danger si relancé.
import fs from 'node:fs';

const done = [];
const patch = (file, fn) => {
  if (!fs.existsSync(file)) return false;
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) { fs.writeFileSync(file, after); done.push(file); }
  return true;
};

// ---------- Android ----------
const manifest = 'android/app/src/main/AndroidManifest.xml';
patch(manifest, (x) => {
  if (!x.includes('android:scheme="charroi"')) {
    x = x.replace(/(<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?>)/, `$1
            <intent-filter android:autoVerify="false">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="charroi" />
            </intent-filter>`);
  }
  const perms = ['android.permission.CAMERA', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.POST_NOTIFICATIONS'];
  for (const p of perms) {
    if (!x.includes(`"${p}"`)) x = x.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
  }
  return x;
}) || console.log('· Android : dossier absent (lancez « npx cap add android » d’abord)');

// ---------- iOS ----------
// Messages des autorisations, en français et en anglais (iOS affiche la langue du téléphone).
const PERM = {
  fr: {
    cam: 'Charroi utilise la caméra pour photographier les marchandises, les preuves de livraison et vos documents.',
    photos: 'Charroi accède à vos photos pour joindre des images de marchandises ou de documents.',
    loc: 'Charroi ajoute votre position à la preuve de livraison, seulement si vous le demandez.',
  },
  en: {
    cam: 'Charroi uses the camera to photograph goods, delivery proofs and your documents.',
    photos: 'Charroi accesses your photos to attach images of goods or documents.',
    loc: 'Charroi adds your location to the delivery proof, only when you ask.',
  },
};
const plist = 'ios/App/App/Info.plist';
patch(plist, (x) => {
  const add = (key, xml) => { if (!x.includes(`<key>${key}</key>`)) x = x.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n${xml}\n</dict>\n</plist>\n`); };
  add('CFBundleURLTypes', `\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>ca.charroi.app</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>charroi</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>`);
  // Textes par défaut en français ; traductions dans fr.lproj / en.lproj (plus bas).
  add('NSCameraUsageDescription', `\t<string>${PERM.fr.cam}</string>`);
  add('NSPhotoLibraryUsageDescription', `\t<string>${PERM.fr.photos}</string>`);
  add('NSLocationWhenInUseUsageDescription', `\t<string>${PERM.fr.loc}</string>`);
  add('CFBundleDevelopmentRegion', '\t<string>fr</string>');
  add('CFBundleLocalizations', '\t<array>\n\t\t<string>fr</string>\n\t\t<string>en</string>\n\t</array>');
  add('UIBackgroundModes', '\t<array>\n\t\t<string>remote-notification</string>\n\t</array>');
  add('ITSAppUsesNonExemptEncryption', '\t<false/>');
  return x;
}) || console.log('· iOS : dossier absent (lancez « npx cap add ios » sur un Mac d’abord)');

// Fichiers de traduction iOS : le téléphone affiche la langue de l’utilisateur.
if (fs.existsSync('ios/App/App')) {
  for (const l of ['fr', 'en']) {
    const dir = `ios/App/App/${l}.lproj`;
    fs.mkdirSync(dir, { recursive: true });
    const p = PERM[l];
    const body = `"CFBundleDisplayName" = "Charroi";\n"NSCameraUsageDescription" = "${p.cam}";\n` +
      `"NSPhotoLibraryUsageDescription" = "${p.photos}";\n"NSLocationWhenInUseUsageDescription" = "${p.loc}";\n`;
    const file = `${dir}/InfoPlist.strings`;
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) { fs.writeFileSync(file, body); done.push(file); }
  }
}

const appDelegate = 'ios/App/App/AppDelegate.swift';
patch(appDelegate, (x) => {
  if (!x.includes('import FirebaseCore')) x = x.replace('import Capacitor', 'import Capacitor\nimport FirebaseCore');
  if (!x.includes('FirebaseApp.configure()')) {
    x = x.replace(/(didFinishLaunchingWithOptions[^{]*\{)/, '$1\n        FirebaseApp.configure()');
  }
  if (!x.includes('didRegisterForRemoteNotificationsWithDeviceToken')) {
    x = x.replace(/\n}\s*$/, `

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
}
`);
  }
  return x;
});

console.log(done.length ? `✓ Modifié :\n  ${done.join('\n  ')}` : 'Rien à modifier.');
if (fs.existsSync('android') && !fs.existsSync('android/app/google-services.json')) console.log('! Ajoutez android/app/google-services.json (Firebase) pour les notifications push.');
if (fs.existsSync('ios/App/App/fr.lproj')) console.log('! Dans Xcode : glissez les dossiers ios/App/App/fr.lproj et en.lproj dans le groupe « App » (cochez la cible App) pour que les textes traduits soient inclus.');
if (fs.existsSync('ios/App/App/fr.lproj')) console.log('! Dans Xcode, glissez ios/App/App/fr.lproj et en.lproj dans le groupe « App » (cible App cochée) pour inclure les traductions. / In Xcode, drag fr.lproj and en.lproj into the “App” group (App target checked).');
if (fs.existsSync('ios') && !fs.existsSync('ios/App/App/GoogleService-Info.plist')) console.log('! Ajoutez ios/App/App/GoogleService-Info.plist (Firebase) dans Xcode pour les notifications push.');
