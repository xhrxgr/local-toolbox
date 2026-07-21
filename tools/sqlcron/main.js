import { injectToolHeader } from '/assets/js/common.js';
import { initSqlCron } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('SQL/CRON');
  initSqlCron();
});
