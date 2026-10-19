/**
 * 掩码编辑：画笔涂抹、橡皮、撤销重做、直线涂抹
 * 掩码与原图同尺寸，255 表示待擦除区域
 * 所有操作只改掩码，绝不触碰原图数据
 */
import { dilate, despeckle } from './detect-ink.js';

const MAX_HISTORY = 20;

export class MaskEditor {
  constructor() {
    this.mask = null;        // Uint8Array
    this.width = 0;
    this.height = 0;
    this.history = [];
    this.index = -1;
  }

  /** 绑定新图像并清空历史 */
  reset(width, height) {
    this.width = width;
    this.height = height;
    this.mask = new Uint8Array(width * height);
    this.history = [];
    this.index = -1;
    this.snapshot();
  }

  snapshot() {
    this.history = this.history.slice(0, this.index + 1);
    this.history.push(this.mask.slice());
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.index = this.history.length - 1;
  }

  /** 开始一次连续涂抹（记录起点以便撤销） */
  beginStroke() {
    this.strokeBase = this.mask.slice();
  }

  /** 画笔/橡皮：把经过的像素写入目标值 */
  paint(x0, y0, x1, y1, radius, value) {
    const { mask, width: w, height: h } = this;
    const r = Math.max(1, Math.round(radius));
    const r2 = r * r;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + r));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + r));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        // 到线段的距离
        let t = ((x - x0) * dx + (y - y0) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = x0 + dx * t;
        const py = y0 + dy * t;
        const ddx = x - px;
        const ddy = y - py;
        if (ddx * ddx + ddy * ddy <= r2) mask[y * w + x] = value;
      }
    }
  }

  /** 结束一次涂抹并记录历史 */
  endStroke() {
    this.snapshot();
  }

  /** 整体操作前调用：把当前掩码写入 fn 的结果 */
  applyOperation(fn) {
    fn(this.mask, this.width, this.height);
    this.snapshot();
  }

  /** 掩码膨胀（覆盖笔迹边缘） */
  expand(radius) {
    if (radius <= 0) return;
    this.applyOperation((m, w, h) => dilate(m, w, h, radius));
  }

  /** 收缩回上一版（膨胀的逆操作不精确，这里用历史实现） */
  undo() {
    if (this.index <= 0) return false;
    this.index--;
    this.mask = this.history[this.index].slice();
    return true;
  }

  redo() {
    if (this.index >= this.history.length - 1) return false;
    this.index++;
    this.mask = this.history[this.index].slice();
    return true;
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.history.length - 1; }

  clear() {
    this.mask.fill(0);
    this.snapshot();
  }

  /** 清理孤立噪点（自动检测后调用） */
  clean(minNeighbors = 2) {
    this.applyOperation((m, w, h) => despeckle(m, w, h, minNeighbors));
  }
}