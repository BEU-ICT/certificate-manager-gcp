export async function load() {
  const a = await import('firebase-admin/firestore');
  const b = require('nodemailer');
  return [a, b];
}
