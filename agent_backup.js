#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const AGENT_AUTH_DIR = process.env.AGENT_AUTH_DIR || path.join(HOME, '.agent-auth');
const CODEX_DIR = process.env.CODEX_DIR || path.join(HOME, '.codex');
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(HOME, '.claude');

const DEFAULT_PROJECT_INCLUDES = ['CLAUDE.md', 'AGENTS.md', '.claude', '.codex'];
const MACHINE_SOURCES = [
  { label: '.claude', source: CLAUDE_DIR },
  { label: '.codex', source: CODEX_DIR },
];

function fail(message) {
  console.error('Error: ' + message);
  process.exit(1);
}

function printBlockTitle(title) {
  process.stdout.write('\n' + title + '\n');
}

function printKv(key, value) {
  process.stdout.write(String(key).padEnd(18) + ' ' + value + '\n');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function tryChmod(target, mode) {
  try {
    fs.chmodSync(target, mode);
  } catch {}
}

function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function sanitizeName(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';
}

function timestamp() {
  return new Date().toISOString().replace(/:/g, '').replace(/\./g, '-');
}

function requireCommand(command, versionArgs) {
  const result = spawnSync(command, versionArgs, { stdio: 'ignore' });
  if (result.error && result.error.code === 'ENOENT') {
    fail('missing required command: ' + command);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) fail(command + ': ' + result.error.message);
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const detail = stderr || stdout;
    fail(command + ' ' + args.join(' ') + ' failed' + (detail ? ': ' + detail : ''));
  }

  return result;
}

function isLocalRepoSpec(repo) {
  return path.isAbsolute(repo) || repo.startsWith('./') || repo.startsWith('../') || repo.startsWith('~/');
}

function expandHome(input) {
  if (input === '~') return HOME;
  if (input.startsWith('~/')) return path.join(HOME, input.slice(2));
  return input;
}

function validateGithubRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    fail('--repo must be owner/repo for GitHub backups: ' + repo);
  }
}

function parseArgs(args, options) {
  const parsed = {
    repo: '',
    createRepo: false,
    projectDir: process.cwd(),
    projectName: '',
    includes: [],
    message: '',
    snapshot: 'latest',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = () => {
      i += 1;
      if (i >= args.length) fail('missing value for ' + arg);
      return args[i];
    };

    if (arg === '--repo') {
      parsed.repo = next();
    } else if (arg === '--create-repo') {
      if (!options.allowCreateRepo) fail('unknown option: ' + arg);
      parsed.createRepo = true;
    } else if (arg === '--project-dir') {
      parsed.projectDir = path.resolve(expandHome(next()));
    } else if (arg === '--project-name') {
      parsed.projectName = next();
    } else if (arg === '--include') {
      if (!options.allowIncludes) fail('unknown option: ' + arg);
      parsed.includes.push(normalizeRelativePath(next()));
    } else if (arg === '--message') {
      if (!options.allowMessage) fail('unknown option: ' + arg);
      parsed.message = next();
    } else if (arg === '--snapshot') {
      if (!options.allowSnapshot) fail('unknown option: ' + arg);
      parsed.snapshot = next();
    } else {
      fail('unknown option: ' + arg);
    }
  }

  if (!parsed.repo) fail('--repo is required');
  if (!parsed.projectName) parsed.projectName = path.basename(parsed.projectDir);
  parsed.projectKey = sanitizeName(parsed.projectName);
  return parsed;
}

function normalizeRelativePath(value) {
  const raw = String(value || '').trim();
  if (!raw) fail('--include expects a non-empty relative path');
  if (path.isAbsolute(raw)) fail('--include must be relative: ' + raw);
  const normalized = path.normalize(raw).replace(/\\/g, '/');
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    fail('--include cannot escape the project directory: ' + raw);
  }
  return normalized;
}

function promptPassphrase() {
  if (process.env.AGENT_AUTH_BACKUP_PASSPHRASE) return process.env.AGENT_AUTH_BACKUP_PASSPHRASE;
  if (process.platform === 'win32') fail('set AGENT_AUTH_BACKUP_PASSPHRASE on Windows');
  if (!process.stdin.isTTY) fail('AGENT_AUTH_BACKUP_PASSPHRASE is required in non-interactive mode');

  let ttyFd;
  try {
    ttyFd = fs.openSync('/dev/tty', 'r+');
  } catch {
    fail('AGENT_AUTH_BACKUP_PASSPHRASE is required because /dev/tty is not available');
  }

  const envPassphrase = { ...process.env, AGENT_AUTH_BACKUP_PASSPHRASE: '' };
  const buffer = Buffer.alloc(1);
  let value = '';

  try {
    fs.writeSync(ttyFd, 'Backup passphrase: ');
    spawnSync('stty', ['-echo'], { stdio: [ttyFd, ttyFd, ttyFd], env: envPassphrase });
    while (true) {
      const bytesRead = fs.readSync(ttyFd, buffer, 0, 1, null);
      if (bytesRead <= 0) break;
      const ch = buffer.toString('utf8');
      if (ch === '\n' || ch === '\r') break;
      value += ch;
    }
    fs.writeSync(ttyFd, '\n');
  } finally {
    spawnSync('stty', ['echo'], { stdio: [ttyFd, ttyFd, ttyFd] });
    fs.closeSync(ttyFd);
  }

  if (!value) fail('empty backup passphrase');
  return value;
}

function getPassphrase() {
  return promptPassphrase();
}

function copyPath(source, destination) {
  const stat = fs.lstatSync(source);
  ensureDir(path.dirname(destination));
  if (stat.isDirectory()) {
    fs.cpSync(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
  } else {
    fs.copyFileSync(source, destination);
    tryChmod(destination, 0o600);
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  tryChmod(file, 0o600);
}

function createTempRoot() {
  ensureDir(path.join(AGENT_AUTH_DIR, 'tmp'));
  return fs.mkdtempSync(path.join(AGENT_AUTH_DIR, 'tmp', 'backup-'));
}

function zipPayload(payloadDir, zipFile) {
  requireCommand('zip', ['-v']);
  run('zip', ['-qry', zipFile, '.'], { cwd: payloadDir });
}

function unzipPayload(zipFile, targetDir) {
  requireCommand('unzip', ['-v']);
  ensureDir(targetDir);
  run('unzip', ['-q', zipFile, '-d', targetDir]);
}

function encryptFile(inputFile, outputFile, passphrase) {
  requireCommand('openssl', ['version']);
  const env = { ...process.env, AGENT_AUTH_BACKUP_PASSPHRASE: passphrase };
  run('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-in', inputFile, '-out', outputFile, '-pass', 'env:AGENT_AUTH_BACKUP_PASSPHRASE'], { env });
  tryChmod(outputFile, 0o600);
}

function decryptFile(inputFile, outputFile, passphrase) {
  requireCommand('openssl', ['version']);
  const env = { ...process.env, AGENT_AUTH_BACKUP_PASSPHRASE: passphrase };
  run('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', inputFile, '-out', outputFile, '-pass', 'env:AGENT_AUTH_BACKUP_PASSPHRASE'], { env });
  tryChmod(outputFile, 0o600);
}

function initLocalRepo(repoPath) {
  const absoluteRepo = path.resolve(expandHome(repoPath));
  ensureDir(path.dirname(absoluteRepo));
  if (!pathExists(absoluteRepo)) {
    run('git', ['init', '--bare', absoluteRepo]);
  }
  return absoluteRepo;
}

function ensureGithubRepo(repo, createRepo) {
  if (isLocalRepoSpec(repo)) {
    return initLocalRepo(repo);
  }

  validateGithubRepo(repo);
  requireCommand('git', ['--version']);
  const ghCheck = spawnSync('gh', ['--version'], { stdio: 'ignore' });
  if (ghCheck.error) {
    if (createRepo) fail('--create-repo requires gh auth login');
    return repo;
  }

  const view = spawnSync('gh', ['repo', 'view', repo], { stdio: 'ignore' });
  if (view.status === 0) return repo;
  if (!createRepo) fail('GitHub repo not found or inaccessible: ' + repo + '. Create it first or add --create-repo.');
  run('gh', ['repo', 'create', repo, '--private']);
  return repo;
}

function cloneRepoToTemp(repo, tempRoot, createRepo) {
  const worktree = path.join(tempRoot, 'repo');
  const resolvedRepo = ensureGithubRepo(repo, createRepo);
  ensureDir(tempRoot);

  if (isLocalRepoSpec(repo)) {
    run('git', ['clone', resolvedRepo, worktree]);
  } else if (!spawnSync('gh', ['--version'], { stdio: 'ignore' }).error) {
    run('gh', ['repo', 'clone', resolvedRepo, worktree]);
  } else {
    run('git', ['clone', 'https://github.com/' + resolvedRepo + '.git', worktree]);
  }

  run('git', ['-C', worktree, 'config', 'user.name', 'agent-auth']);
  run('git', ['-C', worktree, 'config', 'user.email', 'agent-auth@localhost']);
  return worktree;
}

function gitHasChanges(worktree) {
  const result = spawnSync('git', ['-C', worktree, 'diff', '--cached', '--quiet'], { stdio: 'ignore' });
  return result.status !== 0;
}

function commitAndPush(worktree, relPaths, message) {
  run('git', ['-C', worktree, 'add', '--', ...relPaths]);
  if (!gitHasChanges(worktree)) return false;
  run('git', ['-C', worktree, 'commit', '-m', message]);
  run('git', ['-C', worktree, 'push', '-u', 'origin', 'HEAD']);
  return true;
}

function stageMachinePayload(tempRoot) {
  const payloadDir = path.join(tempRoot, 'payload');
  ensureDir(payloadDir);

  const included = [];
  for (const entry of MACHINE_SOURCES) {
    if (!pathExists(entry.source)) continue;
    copyPath(entry.source, path.join(payloadDir, entry.label));
    included.push(entry.label);
  }

  if (included.length === 0) fail('nothing to back up: .claude and .codex are both missing');
  return { payloadDir, included };
}

function stageProjectPayload(tempRoot, projectDir, includes) {
  if (!pathExists(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    fail('missing project directory: ' + projectDir);
  }

  const payloadDir = path.join(tempRoot, 'payload');
  ensureDir(payloadDir);

  const selected = includes.length > 0 ? includes : DEFAULT_PROJECT_INCLUDES;
  const included = [];
  const missing = [];

  for (const rel of selected) {
    const source = path.join(projectDir, rel);
    if (!pathExists(source)) {
      missing.push(rel);
      continue;
    }
    copyPath(source, path.join(payloadDir, rel));
    included.push(rel);
  }

  if (included.length === 0) {
    fail('nothing to back up in ' + projectDir + '. Missing: ' + (missing.join(', ') || selected.join(', ')));
  }

  return { payloadDir, included, missing };
}

function createArchive({ tempRoot, payloadDir, archiveBaseName, manifest, passphrase }) {
  const manifestFile = path.join(payloadDir, '.agent-auth-backup-manifest.json');
  writeJson(manifestFile, manifest);

  const zipFile = path.join(tempRoot, archiveBaseName + '.zip');
  const encryptedFile = path.join(tempRoot, archiveBaseName + '.zip.enc');
  zipPayload(payloadDir, zipFile);
  encryptFile(zipFile, encryptedFile, passphrase);
  fs.rmSync(zipFile, { force: true });

  return {
    archiveFile: encryptedFile,
    archiveName: path.basename(encryptedFile),
  };
}

function backupMachine(args) {
  const options = parseArgs(args, {
    allowCreateRepo: true,
    allowIncludes: false,
    allowMessage: true,
    allowSnapshot: false,
  });
  const passphrase = getPassphrase();
  const tempRoot = createTempRoot();
  const hostKey = sanitizeName(os.hostname());
  const stamp = timestamp();
  const archiveBaseName = stamp + '-machine-' + hostKey;

  try {
    const staged = stageMachinePayload(tempRoot);
    const manifest = {
      version: 1,
      kind: 'machine',
      created_at: new Date().toISOString(),
      hostname: os.hostname(),
      included_paths: staged.included,
    };
    const archive = createArchive({
      tempRoot: tempRoot,
      payloadDir: staged.payloadDir,
      archiveBaseName: archiveBaseName,
      manifest: manifest,
      passphrase: passphrase,
    });

    const worktree = cloneRepoToTemp(options.repo, tempRoot, options.createRepo);
    const repoDir = path.join(worktree, 'machine', hostKey);
    ensureDir(repoDir);

    const archiveTarget = path.join(repoDir, archive.archiveName);
    const manifestTarget = path.join(repoDir, archiveBaseName + '.json');
    fs.copyFileSync(archive.archiveFile, archiveTarget);
    writeJson(manifestTarget, Object.assign({}, manifest, { archive: archive.archiveName }));

    const committed = commitAndPush(worktree, [path.relative(worktree, archiveTarget), path.relative(worktree, manifestTarget)], options.message || 'Back up agent machine config');

    printBlockTitle('Machine backup');
    printKv('repo', options.repo);
    printKv('archive', path.relative(worktree, archiveTarget));
    printKv('manifest', path.relative(worktree, manifestTarget));
    printKv('included', staged.included.join(', '));
    printKv('committed', committed ? 'yes' : 'no');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function backupProject(args) {
  const options = parseArgs(args, {
    allowCreateRepo: true,
    allowIncludes: true,
    allowMessage: true,
    allowSnapshot: false,
  });
  const passphrase = getPassphrase();
  const tempRoot = createTempRoot();
  const stamp = timestamp();
  const archiveBaseName = stamp + '-project-' + options.projectKey;

  try {
    const staged = stageProjectPayload(tempRoot, options.projectDir, options.includes);
    const manifest = {
      version: 1,
      kind: 'project',
      created_at: new Date().toISOString(),
      project_name: options.projectName,
      project_key: options.projectKey,
      included_paths: staged.included,
      missing_paths: staged.missing,
    };
    const archive = createArchive({
      tempRoot: tempRoot,
      payloadDir: staged.payloadDir,
      archiveBaseName: archiveBaseName,
      manifest: manifest,
      passphrase: passphrase,
    });

    const worktree = cloneRepoToTemp(options.repo, tempRoot, options.createRepo);
    const repoDir = path.join(worktree, 'projects', options.projectKey);
    ensureDir(repoDir);

    const archiveTarget = path.join(repoDir, archive.archiveName);
    const manifestTarget = path.join(repoDir, archiveBaseName + '.json');
    fs.copyFileSync(archive.archiveFile, archiveTarget);
    writeJson(manifestTarget, Object.assign({}, manifest, { archive: archive.archiveName }));

    const committed = commitAndPush(worktree, [path.relative(worktree, archiveTarget), path.relative(worktree, manifestTarget)], options.message || 'Back up agent project config');

    printBlockTitle('Project backup');
    printKv('repo', options.repo);
    printKv('project', options.projectKey);
    printKv('archive', path.relative(worktree, archiveTarget));
    printKv('manifest', path.relative(worktree, manifestTarget));
    printKv('included', staged.included.join(', '));
    if (staged.missing.length > 0) printKv('missing', staged.missing.join(', '));
    printKv('committed', committed ? 'yes' : 'no');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function pickArchive(worktree, projectKey, snapshot) {
  const repoDir = path.join(worktree, 'projects', projectKey);
  if (!pathExists(repoDir) || !fs.statSync(repoDir).isDirectory()) {
    fail('no project backups found: projects/' + projectKey);
  }

  const archives = fs.readdirSync(repoDir).filter((entry) => entry.endsWith('.zip.enc')).sort();
  if (archives.length === 0) fail('no project archives found: projects/' + projectKey);
  if (!snapshot || snapshot === 'latest') {
    const archiveName = archives[archives.length - 1];
    return { archiveName: archiveName, archiveFile: path.join(repoDir, archiveName) };
  }

  if (archives.includes(snapshot)) {
    return { archiveName: snapshot, archiveFile: path.join(repoDir, snapshot) };
  }

  if (archives.includes(snapshot + '.zip.enc')) {
    const name = snapshot + '.zip.enc';
    return { archiveName: name, archiveFile: path.join(repoDir, name) };
  }

  const matches = archives.filter((entry) => entry.indexOf(snapshot) === 0);
  if (matches.length === 1) {
    const name = matches[0];
    return { archiveName: name, archiveFile: path.join(repoDir, name) };
  }

  fail('snapshot not found for ' + projectKey + ': ' + snapshot);
}

function backupExistingTarget(targetPath, backupRoot, relPath) {
  if (!pathExists(targetPath)) return false;
  const backupTarget = path.join(backupRoot, relPath);
  ensureDir(path.dirname(backupTarget));
  copyPath(targetPath, backupTarget);
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function restoreProject(args) {
  const options = parseArgs(args, {
    allowCreateRepo: false,
    allowIncludes: true,
    allowMessage: false,
    allowSnapshot: true,
  });
  const passphrase = getPassphrase();
  const tempRoot = createTempRoot();
  const backupRoot = path.join(options.projectDir, '.agent-auth-restore-backup', timestamp());

  try {
    const worktree = cloneRepoToTemp(options.repo, tempRoot, false);
    const archiveInfo = pickArchive(worktree, options.projectKey, options.snapshot);
    const zipFile = path.join(tempRoot, archiveInfo.archiveName.replace(/\.enc$/, ''));
    const payloadDir = path.join(tempRoot, 'restore-payload');

    decryptFile(archiveInfo.archiveFile, zipFile, passphrase);
    unzipPayload(zipFile, payloadDir);

    const manifestFile = path.join(payloadDir, '.agent-auth-backup-manifest.json');
    let manifest = null;
    if (pathExists(manifestFile)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      } catch {}
    }

    const available = manifest && Array.isArray(manifest.included_paths)
      ? manifest.included_paths.map(normalizeRelativePath)
      : DEFAULT_PROJECT_INCLUDES.filter((rel) => pathExists(path.join(payloadDir, rel)));
    const requested = options.includes.length > 0 ? options.includes : available;
    const restored = [];
    const missing = [];
    const overwritten = [];

    ensureDir(options.projectDir);
    for (const rel of requested) {
      const source = path.join(payloadDir, rel);
      if (!pathExists(source)) {
        missing.push(rel);
        continue;
      }
      const target = path.join(options.projectDir, rel);
      if (backupExistingTarget(target, backupRoot, rel)) overwritten.push(rel);
      copyPath(source, target);
      restored.push(rel);
    }

    if (restored.length === 0) fail('nothing restored from ' + archiveInfo.archiveName);

    printBlockTitle('Project restore');
    printKv('repo', options.repo);
    printKv('project', options.projectKey);
    printKv('snapshot', archiveInfo.archiveName);
    printKv('project_dir', options.projectDir);
    printKv('restored', restored.join(', '));
    if (overwritten.length > 0) printKv('backup_dir', backupRoot);
    if (missing.length > 0) printKv('missing', missing.join(', '));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function printUsage(stream) {
  stream.write(
    [
      'Usage:',
      '  agent-auth backup help',
      '  agent-auth backup machine --repo <owner/repo> [--create-repo] [--message <text>]',
      '  agent-auth backup project --repo <owner/repo> [--project-dir <path>] [--project-name <name>] [--include <relative_path> ...] [--create-repo] [--message <text>]',
      '  agent-auth restore project --repo <owner/repo> [--project-dir <path>] [--project-name <name>] [--snapshot latest|<archive_name>] [--include <relative_path> ...]',
      '',
      'Notes:',
      '  - Archives are zipped, encrypted, then copied into the GitHub backup repo.',
      '  - Passphrase source: AGENT_AUTH_BACKUP_PASSPHRASE, or an interactive prompt.',
      '  - --create-repo creates a private GitHub repo when the target repo is missing.',
      '  - Project restores back up overwritten targets to .agent-auth-restore-backup/<timestamp>/ before writing.',
    ].join('\n') + '\n'
  );
}

function runAgentBackupCommand(argv) {
  const action = argv[0] || '';
  const target = argv[1] || '';
  const rest = argv.slice(2);

  if (action === 'help' || action === '-h' || action === '--help' || action === '') {
    if (argv.length > 1) fail('unexpected arguments for backup help');
    printUsage(process.stdout);
    return;
  }

  if (action === 'backup' && (target === 'help' || target === '-h' || target === '--help' || target === '')) {
    if (argv.length > 2) fail('unexpected arguments for backup help');
    printUsage(process.stdout);
    return;
  }

  if (action === 'backup' && target === 'machine') {
    backupMachine(rest);
    return;
  }

  if (action === 'backup' && target === 'project') {
    backupProject(rest);
    return;
  }

  if (action === 'restore' && target === 'project') {
    restoreProject(rest);
    return;
  }

  fail('unknown backup command: ' + (argv.join(' ') || '(empty)'));
}

if (require.main === module) {
  runAgentBackupCommand(process.argv.slice(2));
}

module.exports = {
  runAgentBackupCommand,
};
