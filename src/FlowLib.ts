/// <reference path="./cross-spawn.d.ts" />
import { spawn } from 'cross-spawn'
import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { Extension, StatusIcon } from './extension'
import findRoot from 'find-root'
import resolve from 'resolve'

function formatArg(arg: string): string {
  return /[^-_a-z0-9=.\/]/i.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg
}

const flowBinCache: Map<string, string | null> = new Map()

function cacheFlowBin(cwd: string, flowBin: string | null): void {
  let realpath = fs.realpathSync(cwd)
  const root = findRoot(realpath)
  do {
    flowBinCache.set(cwd, flowBin)
    flowBinCache.set(realpath, flowBin)
    cwd = path.dirname(cwd)
    const nextRealpath = path.dirname(realpath)
    if (realpath === root || nextRealpath === realpath) break
    realpath = nextRealpath
  } while (realpath && realpath !== root)
}

function purgeFlowBin(cwd: string): void {
  let realpath = fs.realpathSync(cwd)
  const root = findRoot(realpath)
  do {
    flowBinCache.delete(cwd)
    flowBinCache.delete(realpath)
    if (realpath === root) break
    cwd = path.dirname(cwd)
    const nextRealpath = path.dirname(realpath)
    if (realpath === root || nextRealpath === realpath) break
    realpath = nextRealpath
  } while (realpath && realpath !== root)
}

type ExecFlowOptions = {
  fileName: string
  fileContents?: string
  args?: (string | number)[]
  token?: vscode.CancellationToken
}

export default class FlowLib {
  private extension: Extension
  /**
   * Map from project root to prev flow command promise command in that project
   */
  private prevCommandPromises: Map<string, Promise<any>> = new Map()
  /**
   * Map from project root to current running flow status command in that project
   */
  private statusPromises: Map<string, Promise<any>> = new Map()

  constructor(extension: Extension) {
    this.extension = extension
  }

  getPathToFlow(cwd: string): string | null {
    if (flowBinCache.has(cwd)) {
      return flowBinCache.get(cwd) || null
    }
    let result: string | null
    try {
      // flow-bin exports the path to the binary
      result = require(resolve.sync('flow-bin', {
        basedir: cwd,
      }))
      this.extension.channel.appendLine(`found flow-bin for ${cwd}: ${result}`)
    } catch (error) {
      result = null
      this.extension.channel.appendLine(`no flow-bin found for ${cwd}`)
    }
    cacheFlowBin(cwd, result)

    const watchedFile = result || path.join(findRoot(cwd), 'package.json')

    // purge the cached result if the binary changes
    // (if no binary was found, watch package.json for changes)
    const watcher = fs.watch(watchedFile)
    watcher.once('change', () => {
      this.extension.channel.appendLine(`changed: ${watchedFile}`)
      watcher.close()
      purgeFlowBin(cwd)
    })
    watcher.once('error', (err: Error) => {
      this.extension.channel.appendLine(
        `error watching ${watchedFile}: ${err.stack}`
      )
      watcher.close()
    })

    return result
  }

  private execFlow({
    fileContents,
    fileName,
    args = [],
    token,
  }: ExecFlowOptions): Promise<any> {
    // only run one command at a time in a given project root, to avoid swamping the flow server with requests
    const root = findRoot(fileName)
    const prevPromise =
      args[0] === 'status'
        ? // status promises have their own mutual exclusion
          Promise.resolve()
        : this.prevCommandPromises.get(root) ||
          this.getDiagnostics({ fileName })
    const result = prevPromise.then(async () => {
      if (token?.isCancellationRequested) throw new Error('operation canceled')
      return await vscode.window.withProgress<any>(
        {
          location: vscode.ProgressLocation.Window,
          cancellable: false,
          title: 'Running Flow',
        },
        (progress) =>
          new Promise((resolve, reject) => {
            if (token?.isCancellationRequested) {
              reject(new Error('operation canceled'))
              return
            }
            const command = `flow ${args.map(formatArg).join(' ')}`
            if (!fs.existsSync(fileName)) {
              resolve(undefined)
              return
            }
            const cwd = path.dirname(fileName)
            const flowBin = this.getPathToFlow(cwd)
            if (!flowBin) {
              resolve(undefined)
              return
            }
            this.extension.channel.appendLine(`Running: ${command}`)
            let flowOutput = ''
            let flowOutputError = ''
            const flowProc = spawn(flowBin, args, { cwd: cwd })
            let rawProc
            if (args[0] === 'status') {
              rawProc = spawn(flowBin, [], { cwd: root, stdio: 'pipe' })
              let lastReportedPercentage = 0
              rawProc.stderr.on('data', (data) => {
                data = data.toString()
                const match = /server is initializing \((.*)\)/i.exec(data)
                const percentageMatch = /(\d+(\.\d*)?|\.\d+)%/.exec(data)
                if (match || percentageMatch) {
                  const report: { message?: string; increment?: number } = {
                    message: match?.[1],
                  }
                  if (percentageMatch) {
                    const percentage = parseFloat(percentageMatch[1])
                    const diff = percentage - lastReportedPercentage
                    lastReportedPercentage = percentage
                    report.increment = diff
                  }
                  progress.report(report)
                }
              })
            }
            if (token) {
              token.onCancellationRequested(() => flowProc.kill('SIGINT'))
            }
            flowProc.on('error', reject)
            flowProc.stdout.on('data', (data) => {
              flowOutput += data.toString()
            })
            flowProc.stderr.on('data', (data) => {
              this.extension.channel.appendLine(
                `flow stderr: ${data.toString()}`
              )
            })
            flowProc.on('exit', (code?: number, signal?: string) => {
              if (rawProc) {
                rawProc.kill()
              }
              if (token?.isCancellationRequested && signal === 'SIGINT') {
                this.extension.channel.appendLine(
                  `Operation was canceled: ${command}`
                )
                reject(new Error('operation canceled'))
              } else if (flowOutputError) {
                this.extension.channel.appendLine(
                  `${command} exited with ${
                    code != null ? `code ${code}` : `signal ${signal}`
                  }: ${flowOutputError}`
                )
                reject(
                  new Error(
                    `flow exited with ${
                      code != null ? `code ${code}` : `signal ${signal}`
                    }: ${flowOutputError}`
                  )
                )
              } else {
                this.extension.channel.appendLine(
                  `Result of ${command}: ${flowOutput}`
                )
                let result = flowOutput
                if (flowOutput && flowOutput.length) {
                  result = JSON.parse(flowOutput)
                }
                resolve(result)
              }
            })
            if (fileContents != null) flowProc.stdin.write(fileContents)
            flowProc.stdin.end()
          })
      )
    })
    if (args[0] === 'status') {
      this.prevCommandPromises.set(
        root,
        result.catch(() => {})
      )
    }
    return result
  }

  getTypeAtPos({
    fileContents,
    fileName,
    position,
    ...options
  }: {
    fileContents: string
    fileName
    position: vscode.Position
    token?: vscode.CancellationToken
  }): Promise<any> {
    return this.execFlow({
      fileContents,
      fileName,
      args: [
        'type-at-pos',
        '--json',
        '--pretty',
        '--path',
        fileName,
        position.line + 1,
        position.character + 1,
      ],
      ...options,
    })
  }

  getDiagnostics({ fileName }: { fileName: string }): Promise<any> {
    // if this gets called before the previous status check (for the project root) finished,
    // just return the pending promise from the previous status check
    const root = findRoot(fileName)
    let promise = this.statusPromises.get(root)
    if (!promise) {
      this.extension.setStatusIcon(StatusIcon.Checking)

      promise = this.execFlow({ fileName, args: ['status', '--json'] })
      promise.then(
        ({ errors }) => {
          this.statusPromises.delete(root)
          this.extension.setStatusIcon(
            errors?.length ? StatusIcon.Error : StatusIcon.Success
          )
        },
        () => {
          this.statusPromises.delete(root)
          this.extension.setStatusIcon(StatusIcon.Error)
        }
      )
      this.statusPromises.set(root, promise)
    }
    return promise
  }

  getAutocomplete({
    fileContents,
    fileName,
    position,
    ...options
  }: {
    fileContents: string
    fileName: string
    position: vscode.Position
    token?: vscode.CancellationToken
  }): Promise<any> {
    return this.execFlow({
      fileContents,
      fileName,
      args: [
        'autocomplete',
        '--json',
        fileName,
        position.line + 1,
        position.character + 1,
      ],
      ...options,
    })
  }

  getDefinition({
    fileContents,
    fileName,
    position,
    ...options
  }: {
    fileContents: string
    fileName: string
    position: vscode.Position
    token?: vscode.CancellationToken
  }): Promise<any> {
    return this.execFlow({
      fileContents,
      fileName,
      args: [
        'get-def',
        '--json',
        fileName,
        position.line + 1,
        position.character + 1,
      ],
      ...options,
    })
  }

  getCoverage({
    fileContents,
    fileName,
  }: {
    fileContents: string
    fileName: string
  }): Promise<any> {
    this.extension.channel.appendLine(`getting coverage for ${fileName}`)
    return this.execFlow({
      fileContents,
      fileName,
      args: ['coverage', '--json', fileName],
    })
  }
}
