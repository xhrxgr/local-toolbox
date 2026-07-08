import { injectToolHeader } from '/assets/js/common.js';
import { initCountdown } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('倒计时');
  initCountdown();
});
