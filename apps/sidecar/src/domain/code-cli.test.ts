import { describe, expect, it } from 'vitest';
import { makeResolvedCodeCli, parseCodeCmd } from './code-cli.js';

describe('VS Code CLI parsing', () => {
  it('parses the code.cmd CLI path with a commit hash directory', () => {
    expect(parseCodeCmd('"%~dp0..\\Code.exe" "%~dp0..\\1.99.0-commit.abc123\\resources\\app\\out\\cli.js"')).toEqual({
      executableRelativePath: '..\\Code.exe',
      cliRelativePath: '..\\1.99.0-commit.abc123\\resources\\app\\out\\cli.js',
    });
  });

  it('TC-M7-040 parses the real VS Code 1.140 code.cmd line with CRLF and trailing %* arguments', () => {
    const contents = [
      '@echo off',
      'setlocal',
      'set VSCODE_DEV=',
      'set ELECTRON_RUN_AS_NODE=1',
      '"%~dp0..\\Code.exe" "%~dp0..\\07f806f999\\resources\\app\\out\\cli.js" %*',
      'IF %ERRORLEVEL% NEQ 0 EXIT /b %ERRORLEVEL%',
      'endlocal',
    ].join('\r\n');

    expect(parseCodeCmd(contents)).toEqual({
      executableRelativePath: '..\\Code.exe',
      cliRelativePath: '..\\07f806f999\\resources\\app\\out\\cli.js',
    });
  });

  it('rejects malformed code.cmd contents', () => {
    expect(parseCodeCmd('echo not the VS Code launcher')).toBeNull();
  });

  it('retains paths containing spaces and accepts non-Windows code passthrough', () => {
    expect(makeResolvedCodeCli('C:\\Program Files\\Microsoft VS Code\\Code.exe', ['cli.js'], true)).toMatchObject({
      executable: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      prefixArgs: ['cli.js'],
      windows: true,
    });
    expect(makeResolvedCodeCli('/opt/Visual Studio Code/bin/code', [], false)).toMatchObject({
      executable: '/opt/Visual Studio Code/bin/code',
      prefixArgs: [],
      windows: false,
    });
    expect(makeResolvedCodeCli('code', [], false)).toBeNull();
    expect(makeResolvedCodeCli('/usr/bin/not-code', [], false)).toBeNull();
  });

  it('TC-M7-043 only creates CLI handles for the allow-listed VS Code executable names', () => {
    expect(makeResolvedCodeCli('C:\\tools\\powershell.exe', [], true)).toBeNull();
    expect(makeResolvedCodeCli('/usr/bin/node', [], false)).toBeNull();
    expect(makeResolvedCodeCli('code', [], false)).toBeNull();
  });
});
