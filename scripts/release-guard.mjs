#!/usr/bin/env node
/**
 * 发版守卫：判断「上个 tag..HEAD」这段改动是否真的改变了**已发布产物的行为**。
 *
 * 判定口径是「能否改变 npm 上的产物」，不是「文件是否随包发布」：
 * 例如 scripts/build-client.mjs 自己不随包，却决定 lib/client.js 长什么样，所以算改变产物。
 *
 * 用法（从 stdin 读路径清单，一行一个）：
 *   git diff --name-only v1.4.2..HEAD | node scripts/release-guard.mjs
 *
 * 退出码：0 = 有产物改动，允许发版；1 = 全是非产物改动，本次不该发版；2 = 用法错误（没喂输入）。
 *
 * ⚠ 它只能判**路径**：行为等价的内部改动（常量换来源、改名、等价重写）它看不出，
 * 那部分仍由 docs/PUBLISHING.md 的问题链 Q0 由人/agent 回答。
 * 宁可漏判也不误拦 —— 未识别的路径一律算「改变产物」。
 */

const NON_ARTIFACT_PREFIXES = ['docs/', 'test/', '.github/', '.agents/', 'assets/'];
/** 工具类脚本：不参与构建产物，改它们不影响 npm 上的包。 */
const NON_ARTIFACT_SCRIPTS = new Set([
  'scripts/acceptance.mjs',
  'scripts/release-guard.mjs',
  'scripts/compat-swap.mjs',
]);
const NON_ARTIFACT_FILES = new Set(['LICENSE', '.gitignore', '.gitattributes', 'screenshots.json']);

/**
 * 判断一个路径是否**不**改变已发布产物。
 *
 * @param {string} file - 仓库相对路径。
 * @returns {boolean} true 表示它改不动 npm 上的产物。
 */
function isNonArtifact(file) {
  if (NON_ARTIFACT_FILES.has(file)) return true;
  if (file.endsWith('.md')) return true;
  if (NON_ARTIFACT_SCRIPTS.has(file)) return true;
  return NON_ARTIFACT_PREFIXES.some((prefix) => file.startsWith(prefix));
}

const input = await new Promise((resolve) => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    text += chunk;
  });
  process.stdin.on('end', () => resolve(text));
});

const files = input
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '');
if (files.length === 0) {
  console.error('没有收到任何改动路径：把 git diff --name-only <base>..HEAD 的输出喂给本脚本。');
  process.exit(2);
}

const artifact = files.filter((file) => !isNonArtifact(file));
const nonArtifact = files.filter(isNonArtifact);
console.log(
  '改动 ' +
    String(files.length) +
    ' 个文件：改变产物的 ' +
    String(artifact.length) +
    ' 个，非产物的 ' +
    String(nonArtifact.length) +
    ' 个。',
);
for (const file of artifact) console.log('  [产物] ' + file);
for (const file of nonArtifact) console.log('  [非产物] ' + file);

if (artifact.length === 0) {
  console.error('');
  console.error('::error::这段区间只有文档 / 测试 / CI / 工具脚本改动，已发布产物的行为没有变化。');
  console.error(
    '按 docs/PUBLISHING.md 的问题链 Q0，本次不发版：改动搭下次发布的车（git 历史即归档）。',
  );
  console.error('确需为此发版时，重新触发 Release 并勾选 force。');
  process.exit(1);
}
process.exit(0);
