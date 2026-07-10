import { injectToolHeader } from '/assets/js/common.js';
import { initUnit } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('单位转换');
  initUnit();
});
