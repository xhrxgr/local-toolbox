import { injectToolHeader } from '/assets/js/common.js';
import { initStopwatch } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('秒表');
  initStopwatch();
});
