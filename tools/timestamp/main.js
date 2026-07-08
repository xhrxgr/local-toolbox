import { injectToolHeader } from '/assets/js/common.js';
import { initTimestamp } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('时间戳');
  initTimestamp();
});
