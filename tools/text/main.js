import { injectToolHeader } from '/assets/js/common.js';
import { initText } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('文本工具');
  initText();
});
