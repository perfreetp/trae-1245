const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const store = require('../store');

function inDateRange(isoStr, from, to) {
  if (!isoStr) return true;
  const d = isoStr.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

const typeLabels = {
  export: { cn: '导出报告', color: 'cyan' },
  audit: { cn: '报告审计', color: 'magenta' },
  retry: { cn: '重试记录', color: 'yellow' },
};

function archiveList(options) {
  const all = store.load('archive') || [];
  const type = options.type || '';
  const from = options.from || '';
  const to = options.to || '';
  let list = all.filter(a => inDateRange(a.createdAt, from, to));
  if (type) list = list.filter(a => (a.type || '').includes(type));

  console.log(chalk.cyan('══════════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('  归档清单 (archive list)'));
  console.log(chalk.cyan('══════════════════════════════════════════════════════════════════'));
  console.log(chalk.white(`  总计: ${list.length} 条`));
  if (type) console.log(chalk.gray(`  筛选类型: ${type}`));
  if (from || to) console.log(chalk.gray(`  时间范围: ${from || '...'} ~ ${to || '...'}`));
  console.log('');

  if (list.length === 0) {
    console.log(chalk.green('  ✓ 暂无归档记录'));
    return;
  }

  list.slice().reverse().forEach(a => {
    const info = typeLabels[a.type] || { cn: a.type || '-', color: 'white' };
    const fp = a.fingerprint ? `指纹:${a.fingerprint}  ` : '';
    console.log(chalk.white(`  ${a.archiveId}`));
    console.log(chalk[info.color](`    [${info.cn}] ${fp}时间:${a.createdAt}`));
    if (a.output) console.log(chalk.gray(`    文件: ${a.output}`));
    if (a.source) console.log(chalk.gray(`    来源: ${a.source}`));
    if (a.summary) {
      const parts = [];
      ['total', 'success', 'failed', 'pending', 'batches', 'flows', 'ships', 'receives', 'verifies', 'recalls', 'missingItems'].forEach(k => {
        if (a.summary[k] !== undefined) parts.push(`${k}=${a.summary[k]}`);
      });
      if (parts.length) console.log(chalk.gray(`    摘要: ${parts.join(', ')}`));
    }
    if (a.filters) {
      const f = a.filters;
      const applied = [];
      if (f.batchNo) applied.push(`批号=${f.batchNo}`);
      if (f.org) applied.push(`机构=${f.org}`);
      if (f.fromDate || f.toDate) applied.push(`日期=${f.fromDate || '...'}~${f.toDate || '...'}`);
      if (applied.length) console.log(chalk.gray(`    筛选: ${applied.join(', ')}`));
    }
    if (a.target && a.target.result) {
      const r = a.target.result;
      console.log(chalk.gray(`    审计结果: fatal=${r.fatal}, error=${r.error}, warn=${r.warn}, canArchive=${r.canArchive}`));
    }
    console.log('');
  });
}

function archiveShow(id) {
  const all = store.load('archive') || [];
  let a = all.find(x => x.archiveId === id);
  if (!a) a = all.find(x => x.archiveId && x.archiveId.includes(id));
  if (!a) {
    console.log(chalk.red(`错误: 归档编号不存在: ${id}`));
    console.log(chalk.gray(`使用 durg-trace archive list 查看所有归档`));
    return;
  }

  const info = typeLabels[a.type] || { cn: a.type || '-', color: 'white' };

  console.log(chalk.cyan('══════════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('  归档详情 (archive show)'));
  console.log(chalk.cyan('══════════════════════════════════════════════════════════════════'));
  console.log(chalk.white(`  归档编号: ${a.archiveId}`));
  console.log(chalk[info.color](`  类型: [${info.cn}]`));
  if (a.fingerprint) console.log(chalk.white(`  指纹: ${a.fingerprint}`));
  console.log(chalk.white(`  创建时间: ${a.createdAt}`));
  if (a.output) {
    const exists = fs.existsSync(a.output);
    console.log(chalk.white(`  输出文件: ${a.output}  ${exists ? chalk.green('(存在)') : chalk.red('(已丢失)')}`));
  }
  if (a.source) console.log(chalk.white(`  审计来源: ${a.source}`));
  if (a.format) console.log(chalk.white(`  格式: ${a.format.toUpperCase()}`));
  console.log('');

  console.log(chalk.white('  一、关键摘要'));
  if (a.summary) {
    Object.entries(a.summary).forEach(([k, v]) => {
      console.log(chalk.gray(`    ${k}: ${v}`));
    });
  } else {
    console.log(chalk.gray('    (无摘要)'));
  }
  console.log('');

  console.log(chalk.white('  二、筛选条件'));
  if (a.filters) {
    const f = a.filters;
    if (f.batchNo) console.log(`    批号: ${f.batchNo}`);
    if (f.org) console.log(`    机构: ${f.org}`);
    if (f.fromDate || f.toDate) console.log(`    日期: ${f.fromDate || '...'} ~ ${f.toDate || '...'}`);
    if (!f.batchNo && !f.org && !f.fromDate && !f.toDate) console.log(chalk.gray('    全量 (无筛选)'));
  } else {
    console.log(chalk.gray('    (无筛选)'));
  }
  console.log('');

  if (a.type === 'audit' && a.target) {
    console.log(chalk.white('  三、审计结论'));
    const r = a.target.result || {};
    if (a.target.reportArchiveId) console.log(`    对应报告归档号: ${a.target.reportArchiveId || '-'}`);
    if (r.canArchive === true) console.log(chalk.green(`    ✓ 可归档`));
    else if (r.canArchive === false) console.log(chalk.red(`    ✗ 需重导`));
    console.log(chalk.gray(`    fatal=${r.fatal || 0}, error=${r.error || 0}, warn=${r.warn || 0}, passed=${r.passed || 0}`));
  }

  if (a.type === 'retry') {
    console.log(chalk.white('  三、重跑文件溯源'));
    if (a.output && fs.existsSync(a.output)) {
      try {
        const data = JSON.parse(fs.readFileSync(a.output, 'utf-8'));
        const files = new Set();
        (data.tasks || []).forEach(t => {
          const f = (t.detail || '').split(' (')[0];
          if (f && f.length > 3) files.add(f);
        });
        console.log(`    涉及任务: ${data.total} 个`);
        console.log(`    涉及文件 (${files.size}):`);
        files.forEach(f => console.log(chalk.gray(`      · ${f}`)));
      } catch (_) {}
    } else {
      console.log(chalk.yellow('    无法读取处理记录文件 (可能已移动)'));
    }
  }

  console.log('');
  console.log(chalk.white('  四、关联归档'));
  let linked = [];
  if (a.type === 'audit' && a.target && a.target.reportArchiveId) {
    linked = all.filter(x => x.archiveId === a.target.reportArchiveId);
  }
  if (a.type === 'export') {
    linked = all.filter(x => x.type === 'audit' && x.target && x.target.reportArchiveId === a.archiveId);
  }
  if (linked.length === 0) {
    console.log(chalk.gray('    (暂无关联归档)'));
  } else {
    linked.forEach(l => {
      const li = typeLabels[l.type] || { cn: l.type, color: 'white' };
      console.log(chalk[li.color](`    ↔ ${l.archiveId} [${li.cn}] ${l.createdAt}`));
    });
  }
  console.log('');
}

function archiveCmd(action, options) {
  if (action === 'list' || !action) {
    archiveList(options || {});
  } else if (action === 'show') {
    const id = options.id || options.archiveId || options._args || '';
    archiveShow(action && action !== 'show' ? action : options.id);
  } else {
    console.log(chalk.red(`未知操作: ${action}`));
    console.log(chalk.gray('可用操作: list / show <id>'));
  }
}

module.exports = archiveCmd;
module.exports.archiveList = archiveList;
module.exports.archiveShow = archiveShow;
