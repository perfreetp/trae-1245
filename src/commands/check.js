const chalk = require('chalk');
const store = require('../store');

function check(options) {
  const accounts = store.load('account');
  const codepacks = store.load('codepack');
  const batches = store.load('batch');
  const flows = store.load('flow');
  const verifies = store.load('verify');

  const issues = [];

  if (accounts.length === 0) {
    issues.push({ group: '账号', level: 'error', msg: '未登录，请先执行 login' });
  }

  codepacks.forEach(p => {
    if (!p.bound) {
      issues.push({ group: '码包', level: 'warn', msg: `码包 ${p.name} 已导入但未绑定` });
    }
  });

  batches.forEach(b => {
    if (!b.packId) {
      issues.push({ group: '批次', level: 'warn', msg: `批号 ${b.batchNo} 未关联码包` });
    }
    if (!b.product) {
      issues.push({ group: '批次', level: 'info', msg: `批号 ${b.batchNo} 未填写产品名称` });
    }
  });

  const shipFlows = flows.filter(f => f.type === 'ship');
  shipFlows.forEach(f => {
    if (f.status === 'reported') {
      const hasReceive = flows.some(r => r.type === 'receive' && r.shipFlowId === f.id);
      if (!hasReceive) {
        issues.push({ group: '流向', level: 'warn', msg: `批号 ${f.batchNo} 发货至 ${f.to} 未确认收货` });
      }
    }
  });

  codepacks.forEach(p => {
    const hasVerify = verifies.some(v => v.packId === p.id);
    if (p.bound && !hasVerify) {
      issues.push({ group: '核验', level: 'info', msg: `码包 ${p.name} 已绑定但未执行抽样验码` });
    }
  });

  if (accounts.length > 0) {
    const latest = accounts[accounts.length - 1];
    if (!latest.org) {
      issues.push({ group: '账号', level: 'warn', msg: '当前账号未设置机构信息，请使用 config set org <名称>' });
    }
  }

  console.log(chalk.cyan('═══════════════════════════════════════'));
  console.log(chalk.cyan('  合规检查报告'));
  console.log(chalk.cyan('═══════════════════════════════════════'));

  if (issues.length === 0) {
    console.log(chalk.green('\n✓ 所有检查项通过，暂无缺失'));
    store.addLog('check', '合规检查通过');
    return;
  }

  const errors = issues.filter(i => i.level === 'error');
  const warns = issues.filter(i => i.level === 'warn');
  const infos = issues.filter(i => i.level === 'info');

  console.log(chalk.red(`\n  错误: ${errors.length}  警告: ${warns.length}  提示: ${infos.length}`));
  console.log('');

  issues.forEach(i => {
    const icon = { error: '✗', warn: '⚠', info: 'ℹ' }[i.level];
    const color = { error: chalk.red, warn: chalk.yellow, info: chalk.blue }[i.level];
    console.log(color(`  ${icon} [${i.group}] ${i.msg}`));
  });

  store.addLog('check', `合规检查: ${errors.length} 错误, ${warns.length} 警告, ${infos.length} 提示`);
}

module.exports = check;
