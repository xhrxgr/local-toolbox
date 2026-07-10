import { injectToolHeader } from '/assets/js/common.js';
import { initPassword } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('密码生成');
  initPassword();
});
