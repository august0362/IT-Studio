/** A successful close unloads this host; command completion alone does not confirm it. */
export async function closeWindow(executeCommand: (command: string) => PromiseLike<unknown>): Promise<boolean> {
  const result = await executeCommand('workbench.action.closeWindow');
  if (typeof result === 'boolean') return result;
  // VS Code returns void before its asynchronous window shutdown finishes.
  // Give the host time to unload before reporting that the window remains open.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 1000);
  });
  return false;
}
