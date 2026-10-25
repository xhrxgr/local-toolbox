import { injectToolHeader } from '/assets/js/common.js';
import { initScripts } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('实用脚本');
  initScripts();
});
