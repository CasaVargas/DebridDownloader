/**
 * Ask the user to confirm a destructive action.
 *
 * In the Tauri WebView, tauri-plugin-dialog replaces `window.confirm` with an async version that
 * returns a Promise. A Promise is always truthy, so `if (window.confirm(...))` ran the action
 * before the user answered (issue #47). Awaiting works for both the patched async version and a
 * plain synchronous browser `confirm`; only an explicit `true` counts as "yes".
 */
export async function confirmAction(message: string): Promise<boolean> {
  const answer: unknown = await (window.confirm(message) as boolean | Promise<boolean>);
  return answer === true;
}
