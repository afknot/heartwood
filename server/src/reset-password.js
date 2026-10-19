// Forgot your password? Run on the server:
//   docker compose exec heartwood node src/reset-password.js
// This removes the password you set in the app and signs out every device.
// You can then sign in with APP_PASSWORD from .env and set a new one in Settings.
import { db } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
const removed = db.prepare(`DELETE FROM secrets WHERE key = 'password_hash'`).run().changes;
db.prepare('DELETE FROM sessions').run();
console.log(removed
  ? 'Password reset. Sign in with APP_PASSWORD from .env, then set a new password in Settings.'
  : 'No in-app password was set; APP_PASSWORD from .env is already the password. All devices signed out.');
