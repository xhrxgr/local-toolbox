/**
 * 统一的模型下载进度（全站共享）
 *
 * 背景：各工具各自算进度，单位还不一致 —— transformers.js 的
 * progress_callback 给的是 0~100，ASR 却当 0~1 用，实测出现
 * 「先闪 100% 再掉回 6%」的乱跳。这里统一约定：
 *   - feed() 接收的原始 progress 一律是 0~100（transformers.js 标准）
 *   - 内部归一化成 0~1 存储
 *   - 对外 snapshot().percent 是 0~100
 *
 * 总体进度按文件体积加权：模型各文件体积差几个数量级（配置几百字节、
 * onnx 几十 MB），按件均分会剧烈跳跃，按体积加权才接近真实进度。
 * 不提供 size 的文件退化为「按件均分」，用于文件清单不固定的场景。
 */

export class DownloadProgress {
  /**
   * @param {Array<{name:string,size?:number,label?:string}>} files 预知的文件清单
   */
  constructor(files = []) {
    this.files = files;
    this.reset();
  }

  reset() {
    // name -> 0~1；Map 保留插入顺序
    this.progress = new Map();
    this.known = new Map(this.files.map((f) => [f.name, f]));
    this.activeName = '';
    this.finished = false;
    // 速度计算：每个文件的字节数 + 最近 3 秒的采样点
    this.bytes = new Map();   // name -> { loaded, total }
    this.samples = [];        // [{ t, loaded }]
  }

  /** 整个下载/加载完成：此时才允许显示 100% */
  finish() {
    this.finished = true;
  }

  /** 收到一条 transformers.js progress_callback 事件
   *  @param {{status:string,file?:string,progress?:number}} e
   */
  feed(e) {
    if (!e || !e.file) return;
    const name = e.file;
    if (e.status === 'done') {
      this.progress.set(name, 1);
      return;
    }
    if (e.status === 'progress' && typeof e.progress === 'number') {
      const p = Math.max(0, Math.min(1, e.progress / 100));
      // 只升不降：重试或乱序回包时不要让进度倒退
      this.progress.set(name, Math.max(this.progress.get(name) || 0, p));
      this.activeName = p < 1 ? name : this.activeName;
      // 记录字节数用于速度计算
      if (typeof e.loaded === 'number' && typeof e.total === 'number' && e.total > 0) {
        this.bytes.set(name, { loaded: e.loaded, total: e.total });
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const sumLoaded = [...this.bytes.values()].reduce((s, b) => s + b.loaded, 0);
        this.samples.push({ t: now, loaded: sumLoaded });
        // 只保留最近 3 秒的采样，实时反映网速变化
        while (this.samples.length > 2 && now - this.samples[0].t > 3000) this.samples.shift();
      }
    }
  }

  /** 标记某文件完成（用于 worker 只发 file-done 而不发 progress 的场景） */
  done(name) {
    if (name) this.progress.set(name, 1);
  }

  /**
   * @returns {{percent:number, active:{name:string,label:string,pct:number}|null,
   *            doneCount:number,totalCount:number,lines:string[]}}
   */
  snapshot() {
    const entries = [...this.progress.entries()];
    const sized = entries.filter(([n]) => this.known.get(n)?.size);
    const unknown = entries.filter(([n]) => !this.known.get(n)?.size);

    let weighted = 0;
    if (sized.length) {
      const totalSize = this.files.reduce((s, f) => s + (f.size || 0), 0);
      for (const [n, p] of sized) weighted += (this.known.get(n).size / totalSize) * p;
    }
    // 未在预知清单里的文件（库实际下载列表可能比清单多）也计入
    let ratio;
    if (sized.length && unknown.length) {
      const part = unknown.reduce((s, [, p]) => s + p, 0) / unknown.length;
      ratio = (weighted + part) / 2;
    } else if (sized.length) {
      ratio = weighted;
    } else if (unknown.length) {
      ratio = unknown.reduce((s, [, p]) => s + p, 0) / unknown.length;
      // 无预知体积时，先完成的小配置文件会让「平均值」瞬间接近 100%，
      // 随后大文件开始又倒退（实测缓存命中的 json 先 100% 再掉到 81%）。
      // 只要没收到调用方的 finish()，一律压在 95% 以内（像 FFmpeg 留尾部
      // 余量）。100% 只在 model-ready / ready 后由 finish() 给出。
      if (!this.finished) ratio = Math.min(ratio, 0.95);
    } else {
      ratio = 0;
    }

    // 注意：不要因为「当前已知文件都 done」就显示 100% ——
    // 缓存命中的小 json 会先单独 done 一下，随后大文件才开始下载，
    // 此时给 100% 会造成「100 → 80」的倒退。100% 由调用方在收到
    // model-ready / ready 消息后自行设置。

    // 活跃文件：优先取最近更新的未完成文件，其次取进度最低的
    let active = null;
    for (const [n, p] of entries) {
      if (p >= 1) continue;
      if (!active || n === this.activeName) {
        active = { name: n, label: this.known.get(n)?.label || shortName(n), pct: Math.round(p * 100) };
      }
    }

    // 文件清单：预知清单在前，实际出现但未知的文件追加在后
    const names = [...new Set([...this.files.map((f) => f.name), ...entries.map(([n]) => n)])];
    const lines = names.map((n) => {
      const p = this.progress.get(n) || 0;
      const label = this.known.get(n)?.label || shortName(n);
      return `${label} · ${p >= 1 ? '完成' : p > 0 ? Math.round(p * 100) + '%' : '等待'}`;
    });

    // 速度与剩余时间：用最近 3 秒的字节增量算滑动窗口，避免瞬时抖动
    let speed = 0;   // 字节/秒
    let eta = 0;     // 秒
    if (this.samples.length >= 2) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      const dt = (last.t - first.t) / 1000;
      const db = last.loaded - first.loaded;
      if (dt > 0.15 && db > 0) speed = db / dt;
    }
    if (speed > 0) {
      // 剩余字节：有 total 的按 total-loaded，没 total 的按预知 size 估
      let remaining = 0;
      for (const [n, b] of this.bytes) {
        if (b.total > b.loaded) remaining += b.total - b.loaded;
        else if (!this.known.get(n)?.size) continue;
      }
      // 预知清单里还没开始下载的文件（进度 0）也要计入剩余
      for (const f of this.files) {
        if (!this.bytes.has(f.name) && f.size) remaining += f.size;
      }
      eta = remaining > 0 ? remaining / speed : 0;
    }

    return {
      percent: Math.max(0, Math.min(100, Math.round(ratio * 100))),
      active,
      doneCount: entries.filter(([, p]) => p >= 1).length,
      totalCount: names.length,
      lines,
      speed: formatSpeed(speed),
      eta: formatEta(eta),
    };
  }
}

/** 字节/秒 → 可读速度 */
export function formatSpeed(bps) {
  if (!bps || bps <= 0) return '';
  if (bps >= 1024 * 1024) return (bps / (1024 * 1024)).toFixed(1) + ' MB/s';
  return Math.round(bps / 1024) + ' KB/s';
}

/** 秒 → 可读剩余时间 */
export function formatEta(sec) {
  if (!sec || !isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `剩余 ${Math.ceil(sec)} 秒`;
  const m = Math.ceil(sec / 60);
  if (m < 60) return `剩余 ${m} 分钟`;
  return `剩余 ${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

/** 长文件名缩短显示：去掉目录，只留主名（保留扩展名） */
export function shortName(name) {
  if (!name) return '';
  const base = name.split('/').pop();
  return base.length > 28 ? base.slice(0, 18) + '…' + base.slice(-8) : base;
}

/**
 * 把 snapshot 渲染到统一结构的 DOM 上。
 * 元素 id 约定（prefix 传入工具前缀，如 'asr'）：
 *   ${prefix}-progress         容器
 *   ${prefix}-progress-title   标题
 *   ${prefix}-progress-pct     百分比数字
 *   ${prefix}-progress-fill    进度条填充
 *   ${prefix}-progress-status  当前文件状态
 *   ${prefix}-progress-files   文件清单
 */
export function renderProgress(prefix, snap, { title, status } = {}) {
  const $ = (suffix) => document.getElementById(`${prefix}-progress${suffix}`);
  const box = $('');
  if (!box) return;
  box.hidden = false;
  if (title && $('-title')) $('-title').textContent = title;
  if ($('-pct')) $('-pct').textContent = snap.percent + '%';
  if ($('-fill')) $('-fill').style.width = snap.percent + '%';
  const st = status || (snap.active
    ? `正在下载 ${snap.active.label} · ${snap.active.pct}%`
    : `下载中 · ${snap.doneCount}/${snap.totalCount} 个文件`);
  if ($('-status')) $('-status').textContent = st;
  if ($('-files')) $('-files').textContent = snap.lines.join('\n');
  const meta = $('-meta');
  if (meta) {
    const parts = [];
    if (snap.speed) parts.push(`<b>${snap.speed}</b>`);
    if (snap.eta) parts.push(`<span class="eta">${snap.eta}</span>`);
    meta.innerHTML = parts.join('');
  }
}

/** 隐藏进度区 */
export function hideProgress(prefix) {
  const box = document.getElementById(`${prefix}-progress`);
  if (box) box.hidden = true;
}
