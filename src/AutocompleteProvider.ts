import * as vscode from 'vscode'
import * as Path from 'path'
import { Extension } from './extension'

const mapToVSCodeType = (item) => {
  if (item.func_details !== null) {
    return vscode.CompletionItemKind.Function
  }
  if (item.type && item.type.indexOf('[class: ') >= 0) {
    return vscode.CompletionItemKind.Class
  }

  return vscode.CompletionItemKind.Variable
}
const buildCodeSnippet = (item) => {
  let codeSnippet = item.name
  const config = vscode.workspace.getConfiguration('flowide')
  if (config.get('useCodeSnippetsOnFunctionSuggest')) {
    if (item.func_details && item.func_details.params) {
      const suggestionArgumentNames = item.func_details.params.map(
        (param) => `{{${param.name.replace('?', '')}}}`
      )
      if (suggestionArgumentNames.length > 0) {
        codeSnippet += '(' + suggestionArgumentNames.join(', ') + '){{}}'
      } else {
        codeSnippet += '()'
      }
    }
  }

  return codeSnippet
}

export default class AutocompleteProvider {
  private extension: Extension

  constructor(extension: Extension) {
    this.extension = extension
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.CompletionItem[] | null> {
    if (!Path.isAbsolute(document.uri.fsPath)) return null
    try {
      const fileContents = document.getText()
      const completions = await this.extension.flowLib.getAutocomplete({
        fileContents,
        fileName: document.uri.fsPath,
        position,
        token,
      })
      if (completions) {
        return completions.result.map((item) => {
          const completionItem = new vscode.CompletionItem(
            item.name,
            mapToVSCodeType(item)
          )
          completionItem.insertText = buildCodeSnippet(item)
          completionItem.detail = item.type
            ? item.type
            : Path.basename(item.path)
          return completionItem
        })
      }
      return null
    } catch (error) {
      if (!token.isCancellationRequested) this.extension.logError(error)
      return null
    }
  }
}
