import { injectToolHeader } from '/assets/js/common.js';
import { initWorldclock } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('世界时间');
  initWorldclock();
});
