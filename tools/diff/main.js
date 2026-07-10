import { injectToolHeader } from '/assets/js/common.js';
import { initDiff } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('文本对比');
  initDiff();
});
