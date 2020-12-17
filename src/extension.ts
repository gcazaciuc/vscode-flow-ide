import HoverProvider from './HoverProvider'
import AutocompleteProvider from './AutocompleteProvider'
import CoverageProvider from './CoverageProvider'
import SignatureProvider from './SignatureProvider'
import DefinitionProvider from './DefinitionProvider'
import { setupDiagnostics } from './Diagnostics'
import * as vscode from 'vscode'
import FlowLib from './FlowLib'

const supportedLanguages = ['javascriptreact', 'javascript']

const documentSelector = supportedLanguages.map((language) => ({
  language,
  scheme: 'file',
}))

export enum StatusIcon {
  Checking = 'loading',
  Success = 'check-all',
  Error = 'alert',
}

export class Extension {
  channel: vscode.OutputChannel = vscode.window.createOutputChannel(
    'vscode-flow-ide'
  )
  flowLib: FlowLib = new FlowLib(this)

  private statusBarItem: vscode.StatusBarItem

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      -1
    )
    this.statusBarItem.command = 'flow.showOutput'
  }

  setStatusIcon(icon: StatusIcon) {
    this.statusBarItem.text = `$(${icon}) Flow`
    this.statusBarItem.show()
  }

  get subscriptions(): vscode.Disposable[] {
    return [this.channel, this.statusBarItem]
  }

  logError(error: Error) {
    const message = `ERROR: ${error.stack || error.message || String(error)}`
    this.channel.appendLine(message)
    const config = vscode.workspace.getConfiguration('flowide')
    if (config.showErrorNotifications) {
      vscode.window.showErrorMessage(message)
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const extension = new Extension()
  context.subscriptions.push(...extension.subscriptions)

  context.subscriptions.push(
    vscode.commands.registerCommand('flow.showOutput', () => {
      extension.channel.show()
    })
  )

  // The registration needs to happen after a timeout because of
  context.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      documentSelector,
      new SignatureProvider(extension),
      '(',
      '.'
    )
  )

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      documentSelector,
      new HoverProvider(extension)
    )
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      documentSelector,
      new AutocompleteProvider(extension),
      '.'
    )
  )

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      documentSelector,
      new DefinitionProvider(extension)
    )
  )

  const coverage = new CoverageProvider(context.subscriptions, extension)
  const refreshCoverage = () => {
    coverage.toggleDecorations()
    coverage.refreshCoverage()
  }
  vscode.commands.registerCommand('flow.coverage', refreshCoverage)
  setupDiagnostics(context.subscriptions, extension)
}

// this method is called when your extension is deactivated
export function deactivate() {}
