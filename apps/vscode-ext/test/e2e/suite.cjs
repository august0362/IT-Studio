const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async function runTCM7050AndTCM7051() {
  const extension = vscode.extensions.getExtension('itstudio.itstudio-vscode');
  assert.ok(extension, 'TC-M7-050: IT Studio extension should be installed for development');
  await extension.activate();

  const expectedPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'src', 'target.txt');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vscode.window.activeTextEditor?.document.uri.fsPath === expectedPath) {
      assert.equal(vscode.window.activeTextEditor.selection.active.line, 1, 'TC-M7-050: reveal should select line 2');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('TC-M7-050: IT Studio did not reveal the requested workspace file');
};
