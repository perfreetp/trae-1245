const chalk = require('chalk');
const store = require('../store');

function bind(packId, options) {
  const codepacks = store.load('codepack');

  if (!packId) {
    console.log(chalk.cyan('未绑定码包列表:'));
    const unbound = codepacks.filter(p => !p.bound);
    if (unbound.length === 0) {
      console.log(chalk.gray('  无未绑定码包'));
      return;
    }
    unbound.forEach(p => {
      console.log(chalk.white(`  ${p.id}  ${p.name}  (${p.total} 码)`));
    });
    return;
  }

  const pack = codepacks.find(p => p.id === packId || p.name === packId);
  if (!pack) {
    console.log(chalk.red(`错误: 码包 ${packId} 不存在`));
    return;
  }

  if (pack.bound) {
    console.log(chalk.yellow(`警告: 码包 ${pack.name} 已绑定`));
    return;
  }

  const productId = options.product || '';
  const spec = options.spec || '';
  const level = options.level || 'min';

  pack.bound = true;
  pack.bindInfo = {
    productId,
    spec,
    level,
    boundAt: new Date().toISOString(),
  };

  store.save('codepack', codepacks);
  store.addLog('bind', `绑定码包 ${pack.name} → 产品 ${productId || '未指定'}, 规格 ${spec || '未指定'}, 级别 ${level}`);

  console.log(chalk.green(`✓ 码包绑定成功`));
  console.log(chalk.white(`  码包: ${pack.name} (${pack.id})`));
  console.log(chalk.white(`  产品ID: ${productId || '未指定'}`));
  console.log(chalk.white(`  规格: ${spec || '未指定'}`));
  console.log(chalk.white(`  包装级别: ${level}`));
  console.log(chalk.white(`  追溯码数量: ${pack.total}`));
}

module.exports = bind;
