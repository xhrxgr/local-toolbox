import { injectToolHeader } from '/assets/js/common.js';
import { initTotpMigration } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('TOTP 迁移');
  initTotpMigration();
});