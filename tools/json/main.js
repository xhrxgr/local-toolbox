import { injectToolHeader } from '/assets/js/common.js';
import { initJson } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('JSON 工具');
  initJson();
});
