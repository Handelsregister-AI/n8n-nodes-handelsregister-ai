const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));
const outputDirectory = path.join(projectRoot, '.e2e');
const packageBaseName = packageJson.name.replace(/^@/, '').replace('/', '-');
const generatedName = `${packageBaseName}-${packageJson.version}.tgz`;
const generatedPath = path.join(outputDirectory, generatedName);
const destinationPath = path.join(outputDirectory, 'handelsregister-node.tgz');

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(destinationPath, { force: true });

execFileSync('npm', ['pack', '--pack-destination', outputDirectory], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (!fs.existsSync(generatedPath)) {
  throw new Error(`Expected npm pack output was not created: ${generatedPath}`);
}

fs.renameSync(generatedPath, destinationPath);
console.log(`Prepared ${destinationPath}`);
