import {error} from 'util';
import {mkdir} from 'fs';
import * as vscode from 'vscode';
import FlowLib from './FlowLib';
import * as Path from 'path';
 
const diagnostics = vscode.languages.createDiagnosticCollection('Flow-IDE');

export function setupDiagnostics(disposables: Array<vscode.Disposable>) {
    // Do an initial call to get diagnostics from the active editor if any
	if (vscode.window.activeTextEditor) {
		updateDiagnostics(vscode.window.activeTextEditor.document);
	}

	// Update diagnostics: when active text editor changes
	disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        const document = editor && editor.document;
		if (document) updateDiagnostics(document);
	}));

	// Update diagnostics when document is edited
	disposables.push(vscode.workspace.onDidSaveTextDocument(event => {
		if (vscode.window.activeTextEditor) {
			updateDiagnostics(vscode.window.activeTextEditor.document);
		}
	}));
}

const fetchFlowDiagnostic = (fileContents: string, filename: string) => {
    return FlowLib.getDiagnostics(fileContents, filename);
}

const mapFlowDiagLevelToVSCode = (flowDiagLevel) => {
    switch(flowDiagLevel) {
        case 'error':
            return vscode.DiagnosticSeverity.Error;
    }
}
const buildDiagnosticMessage = (err) => {
    return err.message.map((m) => {
       return m.type === 'Blame' ? `${m.descr} (${Path.basename(m.path)}:${m.line}:${m.start})` : m.descr
    }).join(' ');
};

const buildOperationDiagnosticMessage = (err) => {
    let m = err.operation;
    return m.type === 'Blame' ? `${m.descr} (${Path.basename(m.path)}:${m.line}:${m.start})` : m.descr;
};

const buildRange = (firstBlame) => new vscode.Range(
                new vscode.Position(firstBlame.line - 1, firstBlame.start - 1),
                new vscode.Position(firstBlame.endline - 1, firstBlame.end)
);
const handleOperationError = (err, groupedDiagnosis) => {
     const firstBlame = err.operation;
        groupedDiagnosis[firstBlame.path] = groupedDiagnosis[firstBlame.path] || []; 
        const message = buildOperationDiagnosticMessage(err) + ' error: ' + buildDiagnosticMessage(err);
        const diag = new vscode.Diagnostic(
            buildRange(firstBlame),
            message,
            mapFlowDiagLevelToVSCode(err.level)
        );
        diag.source = 'flow'
        groupedDiagnosis[firstBlame.path].push(diag);
}

const handleError = (err, groupedDiagnosis) => {
    const firstBlame = err.message.find ((m) => m.type === 'Blame');
        groupedDiagnosis[firstBlame.path] = groupedDiagnosis[firstBlame.path] || []; 

        const diag = new vscode.Diagnostic(
            buildRange(firstBlame),
            buildDiagnosticMessage(err),
            mapFlowDiagLevelToVSCode(err.level)
        );
        diag.source = 'flow'
        groupedDiagnosis[firstBlame.path].push(diag);
}


const mapFlowDiagToVSCode = (errors) => {
    const groupedDiagnosis = {};
    errors.forEach((err) => {
        if(err.operation && err.operation.type === "Blame") {
            handleOperationError(err, groupedDiagnosis);
        } else {
            handleError(err, groupedDiagnosis);
        }
        
    });
    return groupedDiagnosis;
}
const updateDiagnostics = async (document: vscode.TextDocument): Promise<boolean | void> => {
    if (!document) return;
    const filename = document.uri.fsPath;
    const base = Path.basename(filename);
    if (
        !/\.js$/.test(base) && 
        !/\.jsx$/.test(base) &&
        !/\.es6$/.test(base)) {
            return false;
    }
    diagnostics.clear();   
    const flowDiag = await FlowLib.getDiagnostics(document.getText(), filename);
    if (flowDiag && flowDiag.errors) {
        const vscodeDiagByFile = mapFlowDiagToVSCode(flowDiag.errors);
        Object.keys(vscodeDiagByFile).forEach((file) => {
            diagnostics.set( vscode.Uri.file(file), vscodeDiagByFile[file]);
        });
    }
}