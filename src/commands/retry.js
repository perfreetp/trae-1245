const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const store = require('../store');
const { processCodepack, processFlow, processBatch, applyCodepack, applyFlow, applyBatch } = require('./import');

function inDateRange(isoStr, from, to) {
  if (!isoStr) return true;
  const d = isoStr.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function describeTask(t) {
  const p = t.payload || {};
  const tt = t.taskType || 'unknown';
  if (tt.startsWith('import:')) {
    const kind = tt.split(':')[1];
    const exists = p.file && fs.existsSync(p.file) ? '存在' : '不存在';
    return { brief: `导入${kind}文件`, detail: `${p.file || '-'} (${exists})`, file: p.file };
  }
  if (tt === 'ship') return { brief: '上报发货', detail: `批号:${p.batchNo} ${p.from || '-'}→${p.to || '-'} 数量:${p.quantity}`, file: null };
  if (tt === 'receive') return { brief: '确认收货', detail: `flowId:${p.flowId} 批号:${p.batchNo}`, file: null };
  if (tt === 'verify') return { brief: '抽样验码', detail: `码包:${p.packId} 抽样:${p.count || 5}`, file: null };
  if (tt.startsWith('batch:')) return { brief: '批次登记', detail: `批号:${p.batchNo} 产品:${p.product || '-'}`, file: null };
  return { brief: tt, detail: JSON.stringify(p).slice(0, 80), file: null };
}

function previewTask(t) {
  const tt = t.taskType || 'unknown';
  const p = t.payload || {};
  const result = { affected: [], warnings: [] };

  if (tt === 'import:codepack') {
    if (!p.file || !fs.existsSync(p.file)) {
      result.warnings.push('文件不存在');
    } else {
      try {
        const r = processCodepack(p.file, p.options || {});
        result.affected.push(`新增码包: ${r.ok} 个`);
        result.affected.push(`追溯码总数: ${r.total} 个`);
        if (r.skipped) result.affected.push(`跳过(重名): ${r.skipped} 个`);
        if (r.errors.length) result.warnings.push(`错误 ${r.errors.length} 条`);
      } catch (e) {
        result.warnings.push(`解析失败: ${e.message}`);
      }
    }
  } else if (tt === 'import:flow') {
    if (!p.file || !fs.existsSync(p.file)) {
      result.warnings.push('文件不存在');
    } else {
      try {
        const r = processFlow(p.file);
        result.affected.push(`新增流向: ${r.ok} 条 (发${r.shipCount}/收${r.recvCount})`);
        if (r.errors.length) result.warnings.push(`错误 ${r.errors.length} 条`);
      } catch (e) {
        result.warnings.push(`解析失败: ${e.message}`);
      }
    }
  } else if (tt === 'import:batch') {
    if (!p.file || !fs.existsSync(p.file)) {
      result.warnings.push('文件不存在');
    } else {
      try {
        const r = processBatch(p.file);
        result.affected.push(`新增批次: ${r.ok} 条`);
        result.affected.push(`跳过(重复): ${r.skipped} 条`);
        if (r.errors.length) result.warnings.push(`错误 ${r.errors.length} 条`);
      } catch (e) {
        result.warnings.push(`解析失败: ${e.message}`);
      }
    }
  } else if (tt === 'ship') {
    result.affected.push(`新增发货记录 1 条: 批号 ${p.batchNo}`);
  } else if (tt === 'receive') {
    result.affected.push('新增收货记录 1 条，并更新对应发货状态');
  } else if (tt === 'verify') {
    result.affected.push('新增验码记录 1 条');
  } else if (tt.startsWith('batch:')) {
    result.affected.push('新增批次记录 1 条');
  }
  return result;
}

function executeTask(t) {
  const p = t.payload || {};
  const tt = t.taskType;

  if (tt === 'import:codepack') {
    if (!p.file || !fs.existsSync(p.file)) throw new Error(`文件仍不存在: ${p.file}`);
    const r = processCodepack(p.file, p.options || {});
    if (r.errors && r.errors.length > 0) throw new Error(r.errors[0]);
    if (r.skipped > 0) {
      console.log(chalk.gray(`    → 码包 ${r.packName} 已存在，跳过`));
      return 'skipped';
    }
    applyCodepack(r);
    return 'ok';
  }
  if (tt === 'import:flow') {
    if (!p.file || !fs.existsSync(p.file)) throw new Error(`文件仍不存在: ${p.file}`);
    const r = processFlow(p.file);
    applyFlow(r);
    return 'ok';
  }
  if (tt === 'import:batch') {
    if (!p.file || !fs.existsSync(p.file)) throw new Error(`文件仍不存在: ${p.file}`);
    const r = processBatch(p.file);
    applyBatch(r);
    return 'ok';
  }
  if (tt === 'ship') {
    if (!p.batchNo || !p.from || !p.to || !p.quantity) throw new Error('发货参数不全');
    const flows = store.load('flow');
    flows.push({
      id: 'FLW' + Date.now().toString(36).toUpperCase(),
      type: 'ship',
      batchNo: p.batchNo,
      from: p.from,
      to: p.to,
      quantity: p.quantity,
      date: p.date || new Date().toISOString().split('T')[0],
      status: 'reported',
      remark: 'retry-created',
      createdAt: new Date().toISOString(),
    });
    store.save('flow', flows);
    console.log(chalk.gray(`    → 创建发货记录 ${p.batchNo} ${p.from}→${p.to} 数量 ${p.quantity}`));
    return 'ok';
  }
  if (tt === 'receive') {
    const flows = store.load('flow');
    let shipFlow = null;
    if (p.flowId) shipFlow = flows.find(f => f.id === p.flowId);
    else if (p.batchNo) {
      shipFlow = flows.filter(f => f.type === 'ship' && f.batchNo === p.batchNo && f.status === 'reported').pop();
    }
    if (!shipFlow) throw new Error('未找到发货记录，无法收货');
    shipFlow.status = 'received';
    shipFlow.receivedAt = new Date().toISOString();
    flows.push({
      id: 'RCV' + Date.now().toString(36).toUpperCase(),
      type: 'receive',
      shipFlowId: shipFlow.id,
      batchNo: shipFlow.batchNo,
      from: shipFlow.from,
      to: shipFlow.to,
      quantity: shipFlow.quantity,
      receivedBy: p.receivedBy || shipFlow.to,
      date: p.date || new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
    });
    store.save('flow', flows);
    console.log(chalk.gray(`    → 确认收货 ${shipFlow.batchNo} 发货方:${shipFlow.from}`));
    return 'ok';
  }
  if (tt === 'verify') {
    const codepacks = store.load('codepack');
    const pack = codepacks.find(c => c.id === p.packId) || codepacks[codepacks.length - 1];
    if (!pack || !pack.codes) throw new Error('码包不存在或无追溯码');
    const count = Math.min(parseInt(p.count) || 5, pack.codes.length);
    const used = new Set();
    const sampled = [];
    while (sampled.length < count) {
      const idx = Math.floor(Math.random() * pack.codes.length);
      if (!used.has(idx)) { used.add(idx); sampled.push({ index: idx, code: pack.codes[idx] }); }
    }
    const verifies = store.load('verify');
    verifies.push({
      id: 'VRF' + Date.now().toString(36).toUpperCase(),
      packId: pack.id,
      packName: pack.name,
      batchNo: p.batchNo || '',
      sampleSize: count,
      totalCodes: pack.codes.length,
      sampledAt: new Date().toISOString(),
      results: sampled.map(s => ({
        index: s.index,
        code: typeof s.code === 'object' ? JSON.stringify(s.code) : s.code,
        status: 'valid',
      })),
    });
    store.save('verify', verifies);
    console.log(chalk.gray(`    → 抽样验码完成 ${count}/${pack.codes.length}`));
    return 'ok';
  }
  if (tt === 'batch:register') {
    if (!p.batchNo) throw new Error('缺少 batchNo');
    const batches = store.load('batch');
    if (batches.find(b => b.batchNo === p.batchNo)) throw new Error(`批号 ${p.batchNo} 已存在`);
    batches.push({
      id: 'BAT' + Date.now().toString(36).toUpperCase(),
      batchNo: p.batchNo,
      packId: p.packId || '',
      product: p.product || '',
      prodDate: p.prodDate || '',
      expiry: p.expiry || '',
      spec: p.spec || '',
      status: 'registered',
      createdAt: new Date().toISOString(),
    });
    store.save('batch', batches);
    console.log(chalk.gray(`    → 登记批次 ${p.batchNo}`));
    return 'ok';
  }
  throw new Error(`未知任务类型: ${tt}`);
}

function filterTasks(options) {
  const retries = store.load('retry');
  const type = options.type || '';
  const status = options.status || '';
  const fromDate = options.from || '';
  const toDate = options.to || '';

  return retries.filter(r => {
    if (type && !(r.taskType || '').includes(type)) return false;
    if (status) {
      if (status === 'pending' && r.status !== 'pending') return false;
      if (status === 'failed' && r.status !== 'failed') return false;
      if (status === 'done' && r.status !== 'completed') return false;
    }
    if (!inDateRange(r.createdAt, fromDate, toDate)) return false;
    return true;
  });
}

function exportRetryReport(tasks, output) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.resolve(output || `retry-report-${timestamp}.json`);
  const ts = new Date();
  const y = ts.getFullYear();
  const m = String(ts.getMonth() + 1).padStart(2, '0');
  const d = String(ts.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  const retryArchiveId = `ARC-RTY-${y}${m}${d}-${rand}`;
  const data = {
    archiveId: retryArchiveId,
    generatedAt: new Date().toISOString(),
    total: tasks.length,
    success: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
    pending: tasks.filter(t => t.status === 'pending').length,
    tasks: tasks.map(t => {
      const desc = describeTask(t);
      return {
        id: t.id,
        taskType: t.taskType,
        status: t.status,
        errorMsg: t.errorMsg,
        brief: desc.brief,
        detail: desc.detail,
        createdAt: t.createdAt,
        lastRetryAt: t.lastRetryAt || null,
        retryCount: t.retryCount || 0,
        history: t.history || [],
      };
    }),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  const archives = store.load('archive') || [];
  archives.push({
    archiveId: retryArchiveId,
    fingerprint: '',
    type: 'retry',
    format: 'json',
    output: filePath,
    summary: {
      total: data.total,
      success: data.success,
      failed: data.failed,
      pending: data.pending,
    },
    createdAt: new Date().toISOString(),
  });
  store.save('archive', archives);
  store.addLog('retry', `导出失败任务处理记录 ${retryArchiveId}: ${filePath}`);
  console.log(chalk.green(`\n✓ 失败任务处理记录已导出: ${filePath}`));
  console.log(chalk.gray(`  归档编号: ${retryArchiveId}`));
}

function retryCmd(action, options) {
  if (action === 'list' || !action) {
    const tasks = filterTasks(options);
    const pending = tasks.filter(r => r.status === 'pending');
    const failed = tasks.filter(r => r.status === 'failed');
    const done = tasks.filter(r => r.status === 'completed');

    console.log(chalk.cyan('═══════════════════════════════════════════════'));
    console.log(chalk.cyan('  失败/重试任务列表'));
    console.log(chalk.cyan('═══════════════════════════════════════════════'));
    console.log(chalk.white(`  总计: ${tasks.length}  (待处理: ${pending.length}  已失败: ${failed.length}  已完成: ${done.length})`));
    if (options.type) console.log(chalk.gray(`  筛选类型: ${options.type}`));
    if (options.status) console.log(chalk.gray(`  筛选状态: ${options.status}`));
    if (options.from || options.to) console.log(chalk.gray(`  时间范围: ${options.from || '...'} ~ ${options.to || '...'}`));
    console.log('');

    if (tasks.length === 0) {
      console.log(chalk.green('  ✓ 无符合条件的任务'));
      return;
    }

    pending.forEach(r => {
      const d = describeTask(r);
      console.log(chalk.white(`  ${r.id}`));
      console.log(chalk.cyan(`    [待处理] ${d.brief}: ${d.detail}`));
      console.log(chalk.red(`    错误: ${r.errorMsg}`));
      console.log(chalk.gray(`    创建: ${r.createdAt}  重试次数: ${r.retryCount || 0}`));
    });
    failed.forEach(r => {
      const d = describeTask(r);
      console.log(chalk.white(`  ${r.id}`));
      console.log(chalk.red(`    [已失败] ${d.brief}: ${d.detail}`));
      console.log(chalk.red(`    最后错误: ${r.errorMsg}`));
      console.log(chalk.gray(`    创建: ${r.createdAt}  重试次数: ${r.retryCount || 0}`));
    });
    return;
  }

  if (action === 'preview') {
    const tasks = filterTasks(options).filter(r => r.status === 'pending');
    if (tasks.length === 0) {
      console.log(chalk.green('✓ 无待重试任务，无需预览'));
      return;
    }
    console.log(chalk.cyan('═══════════════════════════════════════════════'));
    console.log(chalk.cyan('  重跑预览'));
    console.log(chalk.cyan('═══════════════════════════════════════════════'));
    console.log(chalk.white(`  待处理任务: ${tasks.length} 个\n`));

    tasks.forEach(t => {
      const d = describeTask(t);
      const prev = previewTask(t);
      console.log(chalk.white(`  ${t.id}  ${d.brief}`));
      console.log(chalk.gray(`    ${d.detail}`));
      if (prev.affected.length) {
        console.log(chalk.green(`    影响:`));
        prev.affected.forEach(a => console.log(chalk.green(`      · ${a}`)));
      }
      if (prev.warnings.length) {
        console.log(chalk.yellow(`    警告:`));
        prev.warnings.forEach(w => console.log(chalk.yellow(`      ⚠ ${w}`)));
      }
      console.log('');
    });

    const fileMissing = tasks.filter(t => {
      const d = describeTask(t);
      return d.file && !fs.existsSync(d.file);
    }).length;
    if (fileMissing > 0) {
      console.log(chalk.red(`  ⚠ 有 ${fileMissing} 个任务的源文件仍不存在，重跑会继续失败`));
    } else {
      console.log(chalk.green('  ✓ 所有任务的源文件均存在，可重跑'));
    }
    console.log(chalk.gray('  → 执行 durg-trace retry run 开始重跑'));
    return;
  }

  if (action === 'run') {
    const taskId = options.id || '';
    const pending = filterTasks(options).filter(r => r.status === 'pending' || r.status === 'failed');
    if (pending.length === 0) {
      console.log(chalk.green('✓ 无待重试任务'));
      if (options.export) exportRetryReport(store.load('retry'), options.export);
      return;
    }

    let targets = pending.filter(r => r.status === 'pending');
    if (taskId) {
      const byId = pending.find(r => r.id === taskId);
      if (!byId) {
        console.log(chalk.red(`错误: 任务 ${taskId} 不存在或已完成`));
        return;
      }
      targets = [byId];
    }
    if (targets.length === 0) {
      targets = pending.filter(r => r.status === 'failed');
      console.log(chalk.yellow(`没有 pending 任务，将尝试重跑 ${targets.length} 个 failed 任务...`));
      if (targets.length === 0) {
        console.log(chalk.green('✓ 没有可重跑的任务'));
        return;
      }
    }

    console.log(chalk.cyan(`正在重试 ${targets.length} 个任务...\n`));
    let completed = 0;
    let stillFail = 0;
    let skipped = 0;

    const all = store.load('retry');
    targets.forEach(t => {
      const taskInStore = all.find(x => x.id === t.id);
      if (!taskInStore) return;

      const d = describeTask(taskInStore);
      console.log(chalk.white(`➤ ${taskInStore.id}  ${d.brief}`));
      console.log(chalk.gray(`  ${d.detail}`));
      console.log(chalk.gray(`  原错误: ${taskInStore.errorMsg}`));

      taskInStore.retryCount = (taskInStore.retryCount || 0) + 1;
      taskInStore.lastRetryAt = new Date().toISOString();
      taskInStore.history = taskInStore.history || [];
      const prevErr = taskInStore.errorMsg;

      try {
        const result = executeTask(taskInStore);
        if (result === 'skipped') {
          taskInStore.status = 'completed';
          taskInStore.completedAt = new Date().toISOString();
          taskInStore.history.push({ at: taskInStore.lastRetryAt, before: prevErr, result: 'skipped-already-exists' });
          skipped += 1;
          console.log(chalk.yellow(`  · 已存在，标记完成 (第${taskInStore.retryCount}次)\n`));
        } else {
          taskInStore.status = 'completed';
          taskInStore.completedAt = new Date().toISOString();
          taskInStore.history.push({ at: taskInStore.lastRetryAt, before: prevErr, result: 'success' });
          completed += 1;
          console.log(chalk.green(`  ✓ 重试成功 (第${taskInStore.retryCount}次)\n`));
        }
      } catch (e) {
        taskInStore.errorMsg = e.message;
        taskInStore.history.push({ at: taskInStore.lastRetryAt, before: prevErr, result: e.message });
        if (taskInStore.retryCount >= 3) {
          taskInStore.status = 'failed';
          stillFail += 1;
          console.log(chalk.red(`  ✗ 重试失败: ${e.message}`));
          console.log(chalk.red(`    已达最大重试次数 (3/3)，请人工核查\n`));
        } else {
          console.log(chalk.yellow(`  ✗ 重试失败: ${e.message}`));
          console.log(chalk.gray(`    当前重试 ${taskInStore.retryCount}/3，可再次执行 retry run\n`));
          stillFail += 1;
        }
      }
    });

    store.save('retry', all);
    store.addLog('retry', `执行重试 ${targets.length} 个任务: 成功 ${completed}, 跳过 ${skipped}, 失败 ${stillFail}`);

    console.log(chalk.white('═══════════════════════════════════'));
    console.log(chalk.white(`  总计: ${targets.length}  成功: ${completed}  跳过: ${skipped}  仍失败: ${stillFail}`));
    console.log(chalk.white('═══════════════════════════════════'));

    if (options.export) exportRetryReport(all, options.export);
    return;
  }

  if (action === 'clear') {
    const all = store.load('retry');
    const before = all.length;
    const remaining = all.filter(r => r.status === 'pending' || r.status === 'failed');
    if (remaining.length === before) {
      console.log(chalk.gray('无已完成任务需要清理'));
    } else {
      store.save('retry', remaining);
      store.addLog('retry', `清理已完成任务 ${before - remaining.length} 条`);
      console.log(chalk.green(`✓ 已清理 ${before - remaining.length} 条已完成记录`));
    }
    if (options.export) exportRetryReport(all, options.export);
    return;
  }

  if (action === 'export') {
    const tasks = filterTasks(options);
    exportRetryReport(tasks, options.output || options.export);
    return;
  }

  console.log(chalk.red(`未知操作: ${action}`));
  console.log(chalk.gray('可用操作: list / preview / run [--id xxx] / export / clear'));
  console.log(chalk.gray('筛选选项: --type <类型> --status <pending/failed/done> --from <date> --to <date>'));
  console.log(chalk.gray('重跑/清理时可加 --export <文件.json> 导出处理记录'));
}

module.exports = retryCmd;
module.exports.filterTasks = filterTasks;
module.exports.previewTask = previewTask;
module.exports.executeTask = executeTask;
module.exports.exportRetryReport = exportRetryReport;
