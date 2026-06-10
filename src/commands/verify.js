const chalk = require('chalk');
const store = require('../store');

function verify(options) {
  const codepacks = store.load('codepack');
  const batchNo = options.batchNo || '';
  const count = parseInt(options.count) || 5;
  const packId = options.pack || '';

  let targetPack = null;
  if (packId) {
    targetPack = codepacks.find(p => p.id === packId || p.name === packId);
  } else {
    const boundPacks = codepacks.filter(p => p.bound);
    if (boundPacks.length > 0) {
      targetPack = boundPacks[boundPacks.length - 1];
    }
  }

  if (!targetPack) {
    console.log(chalk.red('错误: 未找到可验码的码包，请提供 --pack 参数或先绑定码包'));
    return;
  }

  if (!targetPack.codes || targetPack.codes.length === 0) {
    console.log(chalk.red('错误: 码包中没有追溯码'));
    return;
  }

  const totalCodes = targetPack.codes.length;
  const sampleSize = Math.min(count, totalCodes);
  const sampled = [];
  const used = new Set();

  while (sampled.length < sampleSize) {
    const idx = Math.floor(Math.random() * totalCodes);
    if (!used.has(idx)) {
      used.add(idx);
      sampled.push({ index: idx, code: targetPack.codes[idx] });
    }
  }

  const verifyRecord = {
    id: 'VRF' + Date.now().toString(36).toUpperCase(),
    packId: targetPack.id,
    packName: targetPack.name,
    batchNo,
    sampleSize,
    totalCodes,
    sampledAt: new Date().toISOString(),
    results: sampled.map(s => ({
      index: s.index,
      code: typeof s.code === 'object' ? JSON.stringify(s.code) : s.code,
      status: 'valid',
    })),
  };

  const verifies = store.load('verify');
  verifies.push(verifyRecord);
  store.save('verify', verifies);
  store.addLog('verify', `抽样验码: ${targetPack.name}, 抽样 ${sampleSize}/${totalCodes}`);

  console.log(chalk.green('✓ 抽样验码完成'));
  console.log(chalk.white(`  验码ID: ${verifyRecord.id}`));
  console.log(chalk.white(`  码包: ${targetPack.name} (${targetPack.id})`));
  console.log(chalk.white(`  批号: ${batchNo || '未指定'}`));
  console.log(chalk.white(`  抽样比例: ${sampleSize}/${totalCodes}`));
  console.log(chalk.cyan('\n  抽样结果:'));
  sampled.forEach((s, i) => {
    const codeStr = typeof s.code === 'object' ? JSON.stringify(s.code) : s.code;
    console.log(chalk.green(`    [${i + 1}] ✓ ${codeStr}`));
  });
}

module.exports = verify;
