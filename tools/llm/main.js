import { injectToolHeader } from '/assets/js/common.js';
import { initLlm } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('本地大模型');
  initLlm();
});
