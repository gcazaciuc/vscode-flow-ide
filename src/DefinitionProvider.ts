import * as vscode from 'vscode'
import * as Path from 'path'
import { Extension } from './extension'

export default class DefinitionProvider {
  private extension: Extension

  constructor(extension: Extension) {
    this.extension = extension
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Location | vscode.Location[] | null> {
    const fileName = document.uri.fsPath
    if (!Path.isAbsolute(fileName)) return null
    try {
      const fileContents = document.getText()
      const definition = await this.extension.flowLib.getDefinition({
        fileContents,
        fileName,
        position,
        token,
      })
      if (definition && definition.path) {
        const startPosition = new vscode.Position(
          Math.max(0, definition.line - 1),
          Math.max(0, definition.start - 1)
        )
        const endPosition = new vscode.Position(
          Math.max(0, definition.endline - 1),
          Math.max(0, definition.end - 1)
        )
        const uri = vscode.Uri.file(definition.path)

        return new vscode.Location(
          uri,
          new vscode.Range(startPosition, endPosition)
        )
      }
      return null
    } catch (error) {
      if (!token.isCancellationRequested) this.extension.logError(error)
      return null
    }
  }
}
