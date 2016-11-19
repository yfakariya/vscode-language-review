'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import * as review from 'review.js';
import * as reviewprh from 'reviewjs-prh';

const review_scheme = "review";

class ReviewTextDocumentContentProvider implements vscode.TextDocumentContentProvider {
	private _onDidChange = new vscode.EventEmitter<vscode.Uri> ();

	public provideTextDocumentContent (uri: vscode.Uri): string | Thenable<string> {
		return vscode.workspace.openTextDocument (vscode.Uri.parse (uri.query)).then (doc => {
			return this.convert (doc);
		});
	}

	get onDidChange(): vscode.Event<vscode.Uri> {
		return this._onDidChange.event;
	}

	public update (uri: vscode.Uri) {
		this._onDidChange.fire (uri);
	}

	private convert (document: vscode.TextDocument): string | Promise<string> {
		let promise = new Promise ((resolve, rejected) => {
			validateDocument (document).then (
				buffer => {
					var result = "";
					buffer.allChunks.forEach (chunk => chunk.builderProcesses.forEach (proc => result += proc.result));
					if (!result.startsWith ("<html") && !result.startsWith ("<!DOCTYPE"))
						result = "<html><head><base href=\"" + document.fileName + "\" /></head><body>" + result + "</body></html>";
					return resolve (result);
				},
				reason => rejected (reason)
			);
		});
		return promise;
	}
}

function reportLevelToSeverity (level: review.ReportLevel): vscode.DiagnosticSeverity {
	switch (level) {
		case review.ReportLevel.Error: return vscode.DiagnosticSeverity.Error;
		case review.ReportLevel.Info: return vscode.DiagnosticSeverity.Information;
		case review.ReportLevel.Warning: return vscode.DiagnosticSeverity.Warning;
	}
	return vscode.DiagnosticSeverity.Information;
}

function locationToRange (loc: review.Location): vscode.Range {
	return new vscode.Range (
		new vscode.Position (loc.start.line - 1, loc.start.column - 1),
		new vscode.Position (loc.end.line - 1, loc.end.column - 1));
}

function showPreview (uri: vscode.Uri) {
	if (!(uri instanceof vscode.Uri)) {
		if (vscode.window.activeTextEditor) {
			uri = vscode.window.activeTextEditor.document.uri;
		}
	}
	return vscode.commands.executeCommand ('vscode.previewHtml', getSpecialSchemeUri (uri), vscode.ViewColumn.Two);
}

function validateDocument (document: vscode.TextDocument): Promise<review.Book> {
	return review.start (controller => {
		controller.initConfig ({
			basePath: path.dirname (document.fileName),
			validators: [new review.DefaultValidator(), new reviewprh.TextValidator(path.join (path.dirname (document.fileName), "prh.yml"))],
			read: path => Promise.resolve(document.getText()),
			listener: {
				// onAcceptables: ... ,
				onReports: function (reports) {
					var dc = Array.of<vscode.Diagnostic> ();
					for (var i = 0; i < reports.length; i++) {
						var loc = reports [i].nodes.length > 0 ? reports [i].nodes [0].location : null;
						dc.push (new vscode.Diagnostic (locationToRange (loc), reports [i].message, reportLevelToSeverity (reports [i].level)));
					}
					vscode.languages.createDiagnosticCollection ("Re:VIEW validation").set (document.uri, dc);
				},
				onCompileFailed: function () {
					vscode.window.showInformationMessage ("compilation failure.");
				}
			},
			builders: [ new review.HtmlBuilder (false) ],
			book: { contents: [ path.basename (document.fileName) ] }
		});
	})
}

export function activate (context : vscode.ExtensionContext) {
    let provider = new ReviewTextDocumentContentProvider ();
    vscode.workspace.onDidChangeTextDocument ((event: vscode.TextDocumentChangeEvent) => {
        if (event.document === vscode.window.activeTextEditor.document) {
            provider.update (getSpecialSchemeUri (event.document.uri));
        }
    });
    let registration = vscode.workspace.registerTextDocumentContentProvider (review_scheme, provider);
	vscode.workspace.onDidSaveTextDocument (e => { if (e.uri.scheme == review_scheme) validateDocument (e); });
    let d1 = vscode.commands.registerCommand ("review.showPreview", uri => showPreview (uri), vscode.ViewColumn.Two);
    context.subscriptions.push (d1, registration);
}

function getSpecialSchemeUri (uri: any): vscode.Uri {
	return uri.with({
		scheme: review_scheme,
		path: uri.path,
		query: uri.toString ()
	});
}

export function deactivate () {
}
