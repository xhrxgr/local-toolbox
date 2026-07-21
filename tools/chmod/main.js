import { injectToolHeader } from '/assets/js/common.js';
import { initChmod } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('权限计算器');
  initChmod();
});
