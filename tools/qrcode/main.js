import { injectToolHeader } from '/assets/js/common.js';
import { initQrcode } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('二维码');
  initQrcode();
});
