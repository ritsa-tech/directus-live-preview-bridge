import { installLivePreviewBridge } from './browser/install-live-preview-bridge.js';

export function createBridgeScript(pollIntervalMs: number): string {
  const options = JSON.stringify({ pollIntervalMs });

  return `;(${installLivePreviewBridge.toString()})(${options});`;
}
