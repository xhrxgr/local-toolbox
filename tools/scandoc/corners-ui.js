/**
 * 四角裁剪覆盖层：SVG 四边形 + 4 个可拖拽手柄
 * 手柄在显示坐标系拖拽，内部转换为原图相对坐标存储
 */
import { rotatedToCorners, cornersToRotated } from './render.js';

export class CornerOverlay {
  /**
   * @param svg      SVG 元素（与画布显示区重合）
   * @param canvas   画布元素（用于尺寸/坐标映射）
   * @param onChange (corners) => void  拖拽结束回调（原图相对坐标）
   * @param onLive   () => void         拖拽中回调（节流后的实时预览）
   */
  constructor(svg, canvas, onChange, onLive) {
    this.svg = svg;
    this.canvas = canvas;
    this.onChange = onChange;
    this.onLive = onLive;
    this.page = null;
    this.dragIndex = -1;

    this.poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    this.poly.setAttribute('class', 'corner-poly');
    this.poly.setAttribute('stroke-linejoin', 'round');

    this.handles = [];
    for (let i = 0; i < 4; i++) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      // 透明的大命中区：手机上 22px 的可见手柄太难点，手指落空就会变成页面滚动。
      // 44px 是常见的最小触控目标尺寸。
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hit.setAttribute('r', '22');
      hit.setAttribute('class', 'corner-handle-hit');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '11');
      circle.setAttribute('class', 'corner-handle');
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dy', '3.5');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-weight', '700');
      label.setAttribute('fill', '#ffffff');
      label.setAttribute('pointer-events', 'none');
      label.textContent = String(i + 1);
      g.appendChild(hit);
      g.appendChild(circle);
      g.appendChild(label);
      g.dataset.index = String(i);
      g.addEventListener('pointerdown', (e) => this.onHandleDown(e, i));
      // 触摸设备上额外拦截 touchstart：部分浏览器对 SVG 子元素的 touch-action 处理不一致，
      // 漏掉这一步会让页面在拖角点时跟着滚动
      g.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      this.handles.push(g);
      this.svg.appendChild(g);
    }
    this.svg.appendChild(this.poly);
    // 保证手柄在 polygon 之上
    this.handles.forEach(h => this.svg.appendChild(h));
  }

  /** 更新显示的页面与角点 */
  setPage(page) {
    this.page = page;
    this.redraw();
  }

  /** 画布尺寸变化 / 角点变化后重绘 */
  redraw() {
    const page = this.page;
    if (!page || !page.corners) {
      this.hide();
      return;
    }
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) {
      this.hide();
      return;
    }
    this.svg.removeAttribute('hidden');
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    // 与画布显示区对齐（wrap 为定位父级）
    this.svg.style.left = `${this.canvas.offsetLeft}px`;
    this.svg.style.top = `${this.canvas.offsetTop}px`;
    this.svg.style.width = `${w}px`;
    this.svg.style.height = `${h}px`;

    // 角点 → 显示坐标（旋转后画布绝对坐标 × 显示缩放）
    const abs = cornersToRotated(page.corners, page);
    const { w: rw, h: rh } = { w: canvasRotatedWidth(page), h: canvasRotatedHeight(page) };
    const sx = w / rw;
    const sy = h / rh;
    const pts = abs.map(p => `${(p.x * sx).toFixed(1)},${(p.y * sy).toFixed(1)}`);
    this.poly.setAttribute('points', pts.join(' '));

    this.handles.forEach((g, i) => {
      const [px, py] = pts[i].split(',').map(Number);
      g.setAttribute('transform', `translate(${px}, ${py})`);
    });
  }

  /** 隐藏覆盖层（注意：SVG 元素无 .hidden IDL 属性，必须操作特性） */
  hide() {
    this.svg.setAttribute('hidden', '');
  }

  onHandleDown(e, index) {
    e.preventDefault();
    e.stopPropagation();
    this.dragIndex = index;
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件 / 异常指针 ID 时忽略，拖拽仍可工作
    }
    // 监听挂在 window 上，而不是手柄元素上：
    // 手柄只有 22px，手指很快就会滑出它的范围；
    // 若监听在元素上，一旦滑出就收不到 pointermove，拖拽会直接断掉。
    // （SVG 元素上的 setPointerCapture 在部分浏览器并不可靠，不能只依赖它）
    const move = (ev) => this.onHandleMove(ev);
    const up = () => {
      this.dragIndex = -1;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.onChange(this.page.corners);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  onHandleMove(e) {
    if (this.dragIndex < 0 || !this.page) return;
    // 拖拽期间阻止页面滚动（pointermove 默认被动监听时阻止无效）
    if (e.cancelable) e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    // 显示坐标 → [0,1] 相对旋转后画布
    const vx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const vy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const { w: rw, h: rh } = { w: canvasRotatedWidth(this.page), h: canvasRotatedHeight(this.page) };
    const viewPoint = { x: vx * rw, y: vy * rh };
    // → 原图相对坐标
    const [orig] = rotatedToCorners([viewPoint], this.page);
    const corners = this.page.corners.map((c, i) => (i === this.dragIndex ? orig : c));
    this.page.corners = corners;
    this.redraw();
  }
}

function canvasRotatedWidth(page) {
  const w = page.img.naturalWidth;
  const h = page.img.naturalHeight;
  return page.rotation % 180 === 90 ? h : w;
}

function canvasRotatedHeight(page) {
  const w = page.img.naturalWidth;
  const h = page.img.naturalHeight;
  return page.rotation % 180 === 90 ? w : h;
}
