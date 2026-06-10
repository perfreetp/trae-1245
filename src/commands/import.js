const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const store = require('../store');

function importCodes(file, options) {
  if (!file) {
    console.log(chalk.red('错误: 请提供码包文件路径'));
    return;
  }

  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.log(chalk.red(`错误: 文件不存在: ${filePath}`));
    return;
  }

  let codes = [];
  const ext = path.extname(filePath).toLowerCase();

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (ext === '.json') {
      const parsed = JSON.parse(content);
      codes = Array.isArray(parsed) ? parsed : parsed.codes || [];
    } else {
      codes = content
        .split(/[\r\n]+/)
        .map(l => l.trim())
        .filter(Boolean);
    }
  } catch (e) {
    console.log(chalk.red(`错误: 读取文件失败: ${e.message}`));
    store.addRetry('import', { file: filePath }, e.message);
    return;
  }

  if (codes.length === 0) {
    console.log(chalk.yellow('警告: 码包文件为空'));
    return;
  }

  const packName = options.name || path.basename(filePath, ext);
  const codepacks = store.load('codepack');

  const codepack = {
    id: 'CP' + Date.now().toString(36).toUpperCase(),
    name: packName,
    source: filePath,
    total: codes.length,
    codes: codes,
    importedAt: new Date().toISOString(),
    bound: false,
  };

  codepacks.push(codepack);
  store.save('codepack', codepacks);
  store.addLog('import', `导入码包 ${packName}, 共 ${codes.length} 个追溯码`);

  console.log(chalk.green(`✓ 码包导入成功`));
  console.log(chalk.white(`  名称: ${packName}`));
  console.log(chalk.white(`  码包ID: ${codepack.id}`));
  console.log(chalk.white(`  追溯码数量: ${codes.length}`));
  console.log(chalk.gray(`  来源: ${filePath}`));

  if (codes.length <= 10) {
    console.log(chalk.gray('  追溯码:'));
    codes.forEach(c => console.log(chalk.gray(`    ${typeof c === 'object' ? JSON.stringify(c) : c}`)));
  } else {
    console.log(chalk.gray(`  前5条追溯码:`));
    codes.slice(0, 5).forEach(c => console.log(chalk.gray(`    ${typeof c === 'object' ? JSON.stringify(c) : c}`)));
    console.log(chalk.gray(`  ... 还有 ${codes.length - 5} 条`));
  }
}

module.exports = importCodes;
