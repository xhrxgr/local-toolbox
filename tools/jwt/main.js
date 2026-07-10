import { injectToolHeader } from '/assets/js/common.js';
import { initJwt } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('JWT 解析');
  initJwt();
});
