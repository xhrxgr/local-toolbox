/**
 * SQL 格式化 + CRON 解释器
 * SQL：sql-formatter（按需 dynamic import）
 * CRON：cronstrue（按需 dynamic import）+ 自实现下次运行时间计算
 */

function initSqlCron() {
  const $ = (id) => document.getElementById(id);

  /* ========== Tab 切换 ========== */
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('mode-tab--active', t === tab));
      document.querySelectorAll('.mode-panel').forEach(p => {
        const active = p.id === `panel-${mode}`;
        p.hidden = !active;
        p.classList.toggle('mode-panel--active', active);
      });
    });
  });

  /* ========== SQL 格式化 ========== */
  async function formatSql() {
    const input = $('sql-input').value;
    if (!input.trim()) {
      $('sql-meta').textContent = '请输入 SQL';
      return;
    }
    $('sql-meta').textContent = '加载 sql-formatter...';
    try {
      const { format, minify } = await import('sql-formatter');
      const dialect = $('sql-dialect').value;
      const indentOpt = $('sql-indent').value;
      const indent = indentOpt === 'tab' ? '\t' : ' '.repeat(parseInt(indentOpt, 10));
      const minifyMode = $('sql-minify').checked;

      const opts = {
        language: dialect,
        tabWidth: indentOpt === 'tab' ? 1 : parseInt(indentOpt, 10),
        useTabs: indentOpt === 'tab',
        keywordCase: $('sql-uppercase').checked ? 'upper' : 'preserve',
      };

      let result;
      if (minifyMode) {
        result = minify(input);
      } else {
        result = format(input, opts);
      }
      $('sql-output').value = result;
      $('sql-meta').textContent = `格式化完成（${result.length} 字符）`;
    } catch (e) {
      $('sql-meta').textContent = '错误：' + e.message;
      $('sql-meta').style.color = '#ef4444';
      return;
    }
    $('sql-meta').style.color = '';
  }

  $('btn-sql-format').addEventListener('click', formatSql);
  $('btn-sql-clear').addEventListener('click', () => {
    $('sql-input').value = '';
    $('sql-output').value = '';
    $('sql-meta').textContent = '';
  });
  $('btn-sql-copy').addEventListener('click', () => {
    if (!$('sql-output').value) return;
    navigator.clipboard.writeText($('sql-output').value).then(() => {
      const btn = $('btn-sql-copy');
      const orig = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  });
  $('sql-input').addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') formatSql();
  });

  /* ========== CRON 解释 ========== */
  async function explainCron() {
    const input = $('cron-input').value.trim();
    if (!input) {
      $('cron-meta').textContent = '请输入 CRON 表达式';
      return;
    }
    const parts = input.split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
      $('cron-meta').textContent = '错误：CRON 应为 5 段（分 时 日 月 周）或 6 段（含秒）';
      $('cron-meta').style.color = '#ef4444';
      return;
    }

    $('cron-meta').textContent = '加载 cronstrue...';
    $('cron-meta').style.color = '';
    try {
      const cronstrue = (await import('cronstrue')).default;
      // cronstrue 默认 5 段（分时日月周），如果 6 段则把第一段（秒）传给 options
      let desc;
      if (parts.length === 6) {
        desc = cronstrue.toString(parts.slice(1).join(' '), {
          dayOfWeekStartIndexZero: true,
          use24HourTimeFormat: true,
          verbose: true,
        });
      } else {
        desc = cronstrue.toString(input, {
          dayOfWeekStartIndexZero: true,
          use24HourTimeFormat: true,
          verbose: true,
        });
      }
      $('cron-desc-value').textContent = desc;
      $('cron-desc').hidden = false;
    } catch (e) {
      $('cron-desc-value').textContent = '解析失败：' + e.message;
      $('cron-desc').hidden = false;
    }

    // 显示字段
    const isSix = parts.length === 6;
    const offset = isSix ? 1 : 0;
    $('field-seconds').textContent = isSix ? parts[0] : '(未指定)';
    $('field-minute').textContent = parts[offset + 0];
    $('field-hour').textContent = parts[offset + 1];
    $('field-day').textContent = parts[offset + 2];
    $('field-month').textContent = parts[offset + 3];
    $('field-weekday').textContent = parts[offset + 4];
    $('field-seconds-wrap').hidden = !isSix;
    $('cron-fields').hidden = false;

    // 计算下次 10 次运行时间
    try {
      const next10 = computeNextRuns(parts, 10);
      const list = $('cron-next-list');
      list.innerHTML = next10.map(d => `<li>${formatDateTime(d)}</li>`).join('');
      $('cron-next').hidden = false;
      $('cron-meta').textContent = '解释完成';
    } catch (e) {
      $('cron-next-list').innerHTML = `<li style="color: #ef4444;">无法计算下次运行时间：${e.message}</li>`;
      $('cron-next').hidden = false;
      $('cron-meta').textContent = '警告：' + e.message;
    }
  }

  /* ========== 自实现 CRON 下次运行时间计算 ========== */
  function computeNextRuns(parts, count) {
    const isSix = parts.length === 6;
    const offset = isSix ? 1 : 0;
    const secField = isSix ? parts[0] : '0';
    const minField = parts[offset + 0];
    const hourField = parts[offset + 1];
    const dayField = parts[offset + 2];
    const monthField = parts[offset + 3];
    const weekField = parts[offset + 4];

    const seconds = parseField(secField, 0, 59);
    const minutes = parseField(minField, 0, 59);
    const hours = parseField(hourField, 0, 23);
    const days = parseField(dayField, 1, 31);
    const months = parseField(monthField, 1, 12);
    const weekdays = parseField(weekField, 0, 6);

    const results = [];
    let now = new Date();
    now.setMilliseconds(0);
    now = new Date(now.getTime() + 1000); // 从下一秒开始

    let attempts = 0;
    const maxAttempts = 500000;

    while (results.length < count && attempts < maxAttempts) {
      attempts++;
      const monthOK = months.has(now.getMonth() + 1);
      const dayOK = days.has(now.getDate());
      const weekdayOK = weekdays.has(now.getDay());
      // CRON 中日和周是 OR 关系（如果两者都不是 *）；这里简化为：如果两者都不是 *，则任一满足即可
      const dayOrWeekOK = (dayField !== '*' && weekField !== '*')
        ? (dayOK || weekdayOK)
        : (dayOK && weekdayOK);

      if (monthOK && dayOrWeekOK && hours.has(now.getHours()) && minutes.has(now.getMinutes()) && seconds.has(now.getSeconds())) {
        results.push(new Date(now));
        now = new Date(now.getTime() + 1000);
        continue;
      }
      // 跳到下一个可能的时刻
      now = new Date(now.getTime() + 1000);
    }
    if (results.length === 0) throw new Error('未找到匹配时刻（表达式可能无效）');
    return results;
  }

  function parseField(field, min, max) {
    const set = new Set();
    for (const part of field.split(',')) {
      const trimmed = part.trim();
      if (trimmed === '*') {
        for (let i = min; i <= max; i++) set.add(i);
      } else if (trimmed.includes('/')) {
        const [base, step] = trimmed.split('/');
        const stepNum = parseInt(step, 10);
        let baseMin = min, baseMax = max;
        if (base !== '*') {
          if (base.includes('-')) {
            const [s, e] = base.split('-');
            baseMin = parseInt(s, 10);
            baseMax = parseInt(e, 10);
          } else {
            baseMin = parseInt(base, 10);
          }
        }
        for (let i = baseMin; i <= baseMax; i += stepNum) set.add(i);
      } else if (trimmed.includes('-')) {
        const [s, e] = trimmed.split('-');
        const start = parseInt(s, 10);
        const end = parseInt(e, 10);
        for (let i = start; i <= end; i++) set.add(i);
      } else {
        const v = parseInt(trimmed, 10);
        if (!isNaN(v)) set.add(v);
      }
    }
    return set;
  }

  function formatDateTime(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} 周${'日一二三四五六'[d.getDay()]}`;
  }

  $('btn-cron-explain').addEventListener('click', explainCron);
  $('cron-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') explainCron();
  });
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $('cron-input').value = btn.dataset.cron;
      explainCron();
    });
  });
}

export { initSqlCron };
