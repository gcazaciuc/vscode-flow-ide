import * as vscode from 'vscode'
import * as Path from 'path'
import { Extension } from './extension'

const diagnostics = vscode.languages.createDiagnosticCollection(
  'vscode-flow-ide'
)

export function setupDiagnostics(
  disposables: Array<vscode.Disposable>,
  extension: Extension
) {
  // Do an initial call to get diagnostics from the active editor if any
  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor.document, extension)
  }

  // Update diagnostics: when active text editor changes
  disposables.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const document = editor && editor.document
      if (document) updateDiagnostics(document, extension)
    })
  )

  // Update diagnostics when document is edited
  disposables.push(
    vscode.workspace.onDidSaveTextDocument((event) => {
      if (vscode.window.activeTextEditor) {
        updateDiagnostics(vscode.window.activeTextEditor.document, extension)
      }
    })
  )
}

const mapFlowDiagLevelToVSCode = (flowDiagLevel) => {
  switch (flowDiagLevel) {
    case 'error':
      return vscode.DiagnosticSeverity.Error
  }
}
const buildDiagnosticMessage = (err) => {
  return err.message
    .map((m) => {
      return m.type === 'Blame'
        ? `${m.descr} (${Path.basename(m.path)}:${m.line}:${m.start})`
        : m.descr
    })
    .join(' ')
}

const buildOperationDiagnosticMessage = (err) => {
  let m = err.operation
  return m.type === 'Blame'
    ? `${m.descr} (${Path.basename(m.path)}:${m.line}:${m.start})`
    : m.descr
}

const buildRange = (firstBlame) =>
  new vscode.Range(
    new vscode.Position(firstBlame.line - 1, firstBlame.start - 1),
    new vscode.Position(firstBlame.endline - 1, firstBlame.end)
  )
const handleOperationError = (err, groupedDiagnosis) => {
  const firstBlame = err.operation
  groupedDiagnosis[firstBlame.path] = groupedDiagnosis[firstBlame.path] || []
  const message =
    buildOperationDiagnosticMessage(err) +
    ' error: ' +
    buildDiagnosticMessage(err)
  const diag = new vscode.Diagnostic(
    buildRange(firstBlame),
    message,
    mapFlowDiagLevelToVSCode(err.level)
  )
  diag.source = 'flow'
  groupedDiagnosis[firstBlame.path].push(diag)
}

const handleError = (err, groupedDiagnosis) => {
  const firstBlame = err.message.find((m) => m.type === 'Blame')
  groupedDiagnosis[firstBlame.path] = groupedDiagnosis[firstBlame.path] || []

  const diag = new vscode.Diagnostic(
    buildRange(firstBlame),
    buildDiagnosticMessage(err),
    mapFlowDiagLevelToVSCode(err.level)
  )
  diag.source = 'flow'
  groupedDiagnosis[firstBlame.path].push(diag)
}

const mapFlowDiagToVSCode = (errors) => {
  const groupedDiagnosis = {}
  errors.forEach((err) => {
    if (err.operation && err.operation.type === 'Blame') {
      handleOperationError(err, groupedDiagnosis)
    } else {
      handleError(err, groupedDiagnosis)
    }
  })
  return groupedDiagnosis
}
const updateDiagnostics = async (
  document: vscode.TextDocument,
  extension: Extension
): Promise<boolean | void> => {
  try {
    if (!document) return
    const fileName = document.uri.fsPath
    if (!Path.isAbsolute(fileName)) return
    const base = Path.basename(fileName)
    if (!/\.(js|jsx|mjs|es6)$/.test(base)) {
      return false
    }
    diagnostics.clear()
    const flowDiag = await extension.flowLib.getDiagnostics({ fileName })
    if (flowDiag && flowDiag.errors) {
      const vscodeDiagByFile = mapFlowDiagToVSCode(flowDiag.errors)
      Object.keys(vscodeDiagByFile).forEach((file) => {
        diagnostics.set(vscode.Uri.file(file), vscodeDiagByFile[file])
      })
    }
  } catch (error) {
    extension.logError(error)
  }
}
