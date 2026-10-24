/**
 * 正则匹配 Worker
 *
 * 为什么需要它：灾难性回溯的正则（如 (a+)+$ 配一长串 a）会让单个 exec() 调用
 * 指数级耗时，而 JS 正则**无法从外部中断**——主线程一旦卡住，整个标签页冻结，
 * 用户只能手动杀页。放进 Worker 后主线程可以随时 terminate 它。
 *
 * 协议：
 *   入参 { id, pattern, flags, text, op }
 *   出参 { id, ok, matches?, replace?, error?, elapsed }
 */

self.onmessage = (e) => {
  const { id, pattern, flags, text, op } = e.data;
  const t0 = Date.now();
  try {
    const regex = new RegExp(pattern, flags);
    let matches = [];
    let replace = null;

    if (op === 'replace') {
      const { replacement, limit } = e.data;
      replace = limit
        ? text.replace(regex, replacement)
        : text.replace(regex, replacement);
    } else {
      if (regex.global) {
        let m;
        let guard = 0;
        while ((m = regex.exec(text)) !== null) {
          matches.push({
            match: m[0],
            index: m.index,
            groups: m.groups || null,
            captures: m.slice(1),
          });
          // 零长度匹配必须手动推进，否则死循环
          if (m.index === regex.lastIndex) regex.lastIndex++;
          if (++guard > 100000) break;
        }
      } else {
        const m = regex.exec(text);
        if (m) {
          matches.push({
            match: m[0],
            index: m.index,
            groups: m.groups || null,
            captures: m.slice(1),
          });
        }
      }
    }

    self.postMessage({ id, ok: true, matches, replace, elapsed: Date.now() - t0 });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message, elapsed: Date.now() - t0 });
  }
};
