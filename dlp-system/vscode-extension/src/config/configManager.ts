import * as vscode from 'vscode';

const SECTION = 'dlp';

export class ConfigManager {
  /**
   * Reads a typed configuration value from the VS Code settings.
   */
  get<T>(key: string): T {
    return vscode.workspace.getConfiguration(SECTION).get<T>(key) as T;
  }

  /**
   * Updates a setting at workspace level.
   */
  async set<T>(key: string, value: T): Promise<void> {
    await vscode.workspace.getConfiguration(SECTION).update(
      key,
      value,
      vscode.ConfigurationTarget.Global
    );
  }

  /**
   * Returns a Disposable that calls `callback` whenever DLP config changes.
   */
  onChange(callback: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(SECTION)) {
        callback();
      }
    });
  }
}