// Donne le rôle d’administrateur à un compte existant.
// Usage : npm run make-admin -- vous@exemple.ca
import { connect, query, close } from '../db.js';

const email = String(process.argv[2] || '').toLowerCase().trim();
if (!email) { console.error('Usage : npm run make-admin -- vous@exemple.ca'); process.exit(1); }
await connect();
const r = await query("update users set role = 'admin' where email = $1 returning id", [email]);
console.log(r.rows.length ? `✓ ${email} est maintenant administrateur.` : `✗ Aucun compte avec le courriel ${email}. Créez d’abord le compte dans l’app.`);
await close();
process.exit(0);
