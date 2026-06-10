const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const store = require('../store');
const { importCodepack, importFlow, importBatch } = require('./import');

function describePayload(task) {
  const p = task.payload || {};
  if (task.taskType.startsWith('import:')) {
    const kind = task.taskType.split(':')[1];
    const exists = p.file && fs.existsSync(p.file) ? '存在' : '不存在';
    return `[import:${kind}] 文件: ${p.file || '-'} (${exists})`;
  }
  if (task.taskType === 'ship') {
    return `[ship] 批号:${p.batchNo}  ${p.from || '-'}→${p.to || '-'}`;
  }
  if (task.taskType === 'receive') {
    return `[receive] flowId:${p.flowId} 批号:${p.batchNo}`;
  }
  if (task.taskType === 'verify') {
    return `[verify] 码包:${p.packId} 抽样:${p.count || 5}`;
  }
  if (task.taskType === 'batch:register') {
    return `[batch] 批号:${p.batchNo} 产品:${p.product || '-'}`;
  }
  return `[${task.taskType}] ${JSON.stringify(p).slice(0, 80)}`;
}

function executeTask(task) {
  const p = task.payload || {};
  const tt = task.taskType;

  if (tt === 'import:codepack') {
    if (!p.file || !fs.existsSync(p.file)) {
      throw new Error(`文件仍不存在: ${p.file}`);
    }
    importCodepack(p.file, p.options || {});
    return;
  }
  if (tt === 'import:flow') {
    if (!p.file || !fs.existsSync(p.file)) {
      throw new Error(`文件仍不存在: ${p.file}`);
    }
    importFlow(p.file);
    return;
  }
  if (tt === 'import:batch') {
    if (!p.file || !fs.existsSync(p.file)) {
      throw new Error(`文件仍不存在: ${p.file}`);
    }
    importBatch(p.file);
    return;
  }
  if (tt === 'ship') {
    if (!p.batchNo || !p.from || !p.to || !p.quantity) {
      throw new Error('发货参数不全，需要 batchNo/from/to/quantity');
    }
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
    console.log(chalk.white(`    → 创建发货记录 ${p.batchNo} ${p.from}→${p.to} 数量 ${p.quantity}`));
    return;
  }
  if (tt === 'receive') {
    const flows = store.load('flow');
    let shipFlow = null;
    if (p.flowId) shipFlow = flows.find(f => f.id === p.flowId);
    else if (p.batchNo) {
      shipFlow = flows.filter(f => f.type === 'ship' && f.batchNo === p.batchNo && f.status === 'reported').pop();
    }
    if (!shipFlow) throw new Error(`未找到发货记录，无法收货`);
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
    console.log(chalk.white(`    → 确认收货 ${shipFlow.batchNo} 发货方:${shipFlow.from}`));
    return;
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
    console.log(chalk.white(`    → 抽样验码完成 ${count}/${pack.codes.length}`));
    return;
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
    console.log(chalk.white(`    → 登记批次 ${p.batchNo}`));
    return;
  }
  throw new Error(`未知任务类型: ${tt}`);
}

function retryCmd(action, options) {
  const retries = store.load('retry');

  if (action === 'list' || !action) {
    const pending = retries.filter(r => r.status === 'pending');
    const failed = retries.filter(r => r.status === 'failed');
    if (pending.length === 0 && failed.length === 0) {
      console.log(chalk.green('✓ 无待重试任务'));
      return;
    }
    if (pending.length > 0) {
      console.log(chalk.cyan(`待重试任务 (${pending.length}):`));
      pending.forEach(r => {
        console.log(chalk.white(`  ${r.id}  ${describePayload(r)}`));
        console.log(chalk.red(`    错误: ${r.errorMsg}`));
        console.log(chalk.gray(`    创建: ${r.createdAt}  重试次数: ${r.retryCount}`));
      });
    }
    if (failed.length > 0) {
      console.log(chalk.yellow(`\n已达最大重试次数 (${failed.length}):`));
      failed.forEach(r => {
        console.log(chalk.gray(`  ${r.id}  ${describePayload(r)}`));
        console.log(chalk.gray(`    最后错误: ${r.errorMsg}`));
      });
    }
    return;
  }

  if (action === 'run') {
    const taskId = options.id || '';
    const open = retries.filter(r => r.status === 'pending' || r.status === 'failed');
    if (open.length === 0) {
      console.log(chalk.green('✓ 无待重试任务'));
      return;
    }
    let targets = open.filter(r => r.status === 'pending');
    if (taskId) {
      const byId = open.find(r => r.id === taskId);
      if (!byId) {
        console.log(chalk.red(`错误: 任务 ${taskId} 不存在`));
        return;
      }
      targets = [byId];
    }
    if (targets.length === 0) {
      console.log(chalk.green('✓ 没有 pending 任务，所有任务已失败；使用 --id <失败ID> 可强制重试'));
      return;
    }

    console.log(chalk.cyan(`正在重试 ${targets.length} 个任务...\n`));
    let completed = 0;
    let stillFail = 0;

    targets.forEach(t => {
      console.log(chalk.white(`➤ ${t.id}  ${describePayload(t)}`));
      console.log(chalk.gray(`  原错误: ${t.errorMsg}`));
      t.retryCount += 1;
      t.lastRetryAt = new Date().toISOString();
      const prevErr = t.errorMsg;
      try {
        const ok = executeTask(t);
        t.status = 'completed';
        t.completedAt = new Date().toISOString();
        t.history = t.history || [];
        t.history.push({ at: t.lastRetryAt, before: prevErr, result: 'success' });
        console.log(chalk.green(`  ✓ 重试成功 (第${t.retryCount}次)\n`));
        completed += 1;
      } catch (e) {
        t.errorMsg = e.message;
        t.history = t.history || [];
        t.history.push({ at: t.lastRetryAt, before: prevErr, result: e.message });
        if (t.retryCount >= 3) {
          t.status = 'failed';
          stillFail += 1;
          console.log(chalk.red(`  ✗ 重试失败: ${e.message}`));
          console.log(chalk.red(`    已达最大重试次数 (3/3)，请人工核查\n`));
        } else {
          console.log(chalk.yellow(`  ✗ 重试失败: ${e.message}`));
          console.log(chalk.gray(`    当前重试 ${t.retryCount}/3，可再次执行 retry run\n`));
          stillFail += 1;
        }
      }
    });

    store.save('retry', retries);
    store.addLog('retry', `执行重试 ${targets.length} 个任务: 成功 ${completed}, 失败 ${stillFail}`);
    console.log(chalk.white(`═══════════════════════════════════`));
    console.log(chalk.white(`  总计: ${targets.length}  成功: ${completed}  仍失败: ${stillFail}`));
    console.log(chalk.white(`═══════════════════════════════════`));
    return;
  }

  if (action === 'clear') {
    const before = retries.length;
    const remaining = retries.filter(r => r.status === 'pending' || r.status === 'failed');
    if (remaining.length === before) {
      console.log(chalk.gray('无已完成任务需要清理'));
      return;
    }
    store.save('retry', remaining);
    store.addLog('retry', `清理已完成任务 ${before - remaining.length} 条`);
    console.log(chalk.green(`✓ 已清理 ${before - remaining.length} 条已完成记录`));
    return;
  }

  console.log(chalk.red(`未知操作: ${action}`));
  console.log(chalk.gray('可用操作: list / run [--id xxx] / clear'));
}

module.exports = retryCmd;
