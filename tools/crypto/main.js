import { injectToolHeader } from '/assets/js/common.js';
import { initCrypto } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('加解密工具');
  initCrypto();
});
