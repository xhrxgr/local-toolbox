import { injectToolHeader } from '/assets/js/common.js';
import { initTranslate } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('shell-translate');
  injectToolHeader('离线翻译');
  initTranslate();
});
