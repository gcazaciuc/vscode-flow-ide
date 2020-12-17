import * as vscode from 'vscode'
import * as Path from 'path'
import { Extension } from './extension'
import prettier from 'prettier'

export default class HoverProvider {
  private extension: Extension

  constructor(extension: Extension) {
    this.extension = extension
  }

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const fileName = document.uri.fsPath
    if (!Path.isAbsolute(fileName)) return null
    try {
      const wordPosition = document.getWordRangeAtPosition(position)
      if (!wordPosition) return null
      const word = document.getText(wordPosition)
      const typeAtPos = await this.extension.flowLib.getTypeAtPos({
        fileContents: document.getText(),
        fileName,
        position,
        token,
      })
      if (!typeAtPos) return null
      let value = `type ${word} = ${typeAtPos.type}`
      for (const candidate of [
        `type ${word} = ${typeAtPos.type}`,
        `type _${word}_ = ${typeAtPos.type}`,
        typeAtPos.type,
      ]) {
        try {
          value = prettier.format(candidate, {
            semi: false,
            parser: 'flow',
            trailingComma: 'es5',
          })
          break
        } catch (error) {}
      }
      return new vscode.Hover([
        'vscode-flow-ide',
        { language: 'javascriptreact', value },
      ])
    } catch (error) {
      if (!token.isCancellationRequested) this.extension.logError(error)
      return null
    }
  }
}
