import { injectToolHeader } from '/assets/js/common.js';
import { initCert } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('证书解析');
  initCert();
});
