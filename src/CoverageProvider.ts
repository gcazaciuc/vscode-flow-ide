import * as vscode from 'vscode'
import * as Path from 'path'
import { Extension } from './extension'

export default class CoverageDecorations {
  private notCoveredLine: vscode.TextEditorDecorationType
  private coverageData: any
  private _decorationsOn: boolean
  private _statusBar: vscode.StatusBarItem
  private extension: Extension

  constructor(disposables, extension: Extension) {
    this.extension = extension
    this.notCoveredLine = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'darkred',
    })
    this._decorationsOn = false
    this._statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left
    )
    this.coverageData = {}
    disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshCoverage())
    )
    disposables.push(
      vscode.workspace.onDidSaveTextDocument(() => this.refreshCoverage())
    )
  }

  refreshCoverage() {
    vscode.window.visibleTextEditors.forEach(
      async (editor): Promise<void> => {
        try {
          const coverage = await this.getCoverage(editor)
          if (coverage) this.coverageUpdated(coverage, editor)
        } catch (error) {
          this.extension.logError(error)
        }
      }
    )
  }
  toggleDecorations() {
    this._decorationsOn = this._decorationsOn ? false : true
  }
  coverageUpdated(coverageData, editor) {
    const activeEditor = vscode.window.activeTextEditor
    const filename = editor.document.uri.fsPath
    this.coverageData[filename] = coverageData
    if (activeEditor) {
      const currentFilename = activeEditor.document.uri.fsPath
      const currentCoverage = this.coverageData[currentFilename]
      if (currentCoverage) {
        const coverageRatio =
          coverageData.covered_count /
          (coverageData.covered_count + coverageData.uncovered_count)
        const coveragePercent = Number(coverageRatio * 100).toFixed(0)
        this._statusBar.text = `Flow coverage ${coveragePercent}%`
        this._statusBar.show()
      } else {
        this._statusBar.hide()
      }
    } else {
      this._statusBar.hide()
    }
    this._updateEditor(editor, filename)
  }
  mapToRanges(filename) {
    return this.coverageData[filename].uncovered_locs.map(
      (detail) =>
        new vscode.Range(
          detail.start.line - 1,
          detail.start.column - 1,
          detail.end.line - 1,
          detail.end.column
        )
    )
  }
  async getCoverage(editor: vscode.TextEditor): Promise<any> {
    const fileName = editor.document.uri.fsPath
    if (!Path.isAbsolute(fileName)) return null
    const fileContents = editor.document.getText()
    if (!fileContents) return null
    const coverage = await this.extension.flowLib.getCoverage({
      fileContents,
      fileName,
    })
    if (coverage) return coverage.expressions
  }
  _updateEditor(editor, filename) {
    if (!editor) {
      return
    }
    if (this._decorationsOn) {
      editor.setDecorations(this.notCoveredLine, this.mapToRanges(filename))
    } else {
      editor.setDecorations(this.notCoveredLine, [])
    }
  }
}
