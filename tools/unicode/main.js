import { injectToolHeader } from '/assets/js/common.js';
import { initUnicode } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('Unicode 查看器');
  initUnicode();
});
