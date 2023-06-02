/*********************************************************************
 * Copyright (c) 2021 Kichwa Coders Canada Inc. and others
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *********************************************************************/
// import * as cp from 'child_process';
// import * as os from 'os';
// import * as path from 'path';
import {
    InitializedEvent,
    Logger,
    logger,
    LoggingDebugSession,
    Event,
    Handles,
    Response,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { AmalgamatorClient } from './AmalgamatorClient';

export interface ChildDapArguments {
    /**
     * User visisble name, used to prefix the thread name returned by child dap
     */
    name?: string;

    /**
     * Instead of type/request that VSCode converts to a command using
     * the extension mechanism from the package.json's program settings,
     * the command needs to be fully provided here as runtime/executable.
     *
     * XXX: We read the package.json and use the type/request to create
     * the command, but it is VSCode specific (probably same/similar available
     * in theia?). Look at vscode.debug.onDidStartDebugSession to update the debug
     * config before launch and vscode.extensions.getExtension(...).packageJSON
     * For the former see https://github.com/Microsoft/vscode/issues/32794 and
     * https://github.com/microsoft/vscode-node-debug/blob/a062e12aa1f2307682c0ccb1eb5d99505b1eaea2/src/node/extension/extension.ts#L194
     * for the correct link to the code.
     */
    debugAdapterRuntime: string;
    debugAdapterExecutable: string;

    /**
     * Delay, in milliseconds, before launching this instance. This is being use to demonstrate a small
     * amount of interdependence between launch configs. Defaults to 0.
     */
    delay?: number;

    /**
     * Specify launch or attach request to start debugging for children
     */
    request?: string;

    /**
     * This is the request arguments (normally specified in the launch.json)
     */
    arguments:
        | DebugProtocol.LaunchRequestArguments
        | DebugProtocol.AttachRequestArguments;
}

export interface RequestArguments extends DebugProtocol.LaunchRequestArguments {
    verbose?: boolean;
    logFile?: string;
    children: ChildDapArguments[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface LaunchRequestArguments extends RequestArguments {}

/**
 * Response for our custom 'cdt-amalgamator/getChildDapNames' request.
 */
export interface ChildDapContents {
    children?: string[];
}

export interface ChildDapResponse extends Response {
    body: ChildDapContents;
}

export class StoppedEvent extends Event implements DebugProtocol.StoppedEvent {
    public body: {
        reason: string;
        threadId?: number;
        allThreadsStopped?: boolean;
        preserveFocusHint?: boolean;
    };

    constructor(
        reason: string,
        threadId: number,
        preserveFocusHint: boolean,
        allThreadsStopped: boolean
    ) {
        super('stopped');

        this.body = {
            reason,
            threadId,
            allThreadsStopped,
            preserveFocusHint,
        };
    }
}

export class ContinuedEvent
    extends Event
    implements DebugProtocol.ContinuedEvent
{
    public body: {
        /** The thread which was continued. */
        threadId: number;
        /** If 'allThreadsContinued' is true, a debug adapter can announce that all threads have continued. */
        allThreadsContinued?: boolean;
    };

    constructor(threadId: number, allThreadsContinued: boolean) {
        super('continued');
        this.body = { threadId, allThreadsContinued };
    }
}

export interface ThreadInfo extends DebugProtocol.Thread {
    running: boolean;
}

export class AmalgamatorSession extends LoggingDebugSession {
    /* A reference to the logger to be used by subclasses */
    protected logger: Logger.Logger;

    protected initializeRequestArgs:
        | DebugProtocol.InitializeRequestArguments
        | undefined;

    /* child processes XXX: A type that represents the union of the following datastructures? */
    protected childDaps: AmalgamatorClient[] = [];
    /**
     * This is a map of the start/end addresses or the instructionPointerReference that client sees -> child DAP index, child DAP addresses
     *
     * It is needed to workaround for problems:
     *  1. VSCode assuming that the instructionPointerReference has the same format as DisassembledInstruction.address
     *  even though the spec doesn't say so.
     *  See the spec at https://microsoft.github.io/debug-adapter-protocol/specification#Types_StackFrame
     *  The problem has been reported at https://github.com/microsoft/vscode/issues/164875
     *  2. VSCode/debug adapter protocol does not support multiple memory spaces.
     *  The problem has been reported at https://github.com/microsoft/vscode/issues/164877
     * Solution:
     *  Based on elements: start addresses or end addresses or the instructionPointerReference to determine
     *  the child dap to be handled.
     * Note:
     *  1. This should be updated after problems are resolved
     *  2. Limit of the solution is this can work incorrectly when child daps have same start addresses
     *  or end addresses or the instructionPointerReference.
     */
    protected addressMap: Map<string, number> = new Map<string, number>();
    protected childDapNames: string[] = [];
    protected childDapIndex?: number;
    protected breakpointHandles: Handles<[AmalgamatorClient, number]> =
        new Handles();
    protected frameHandles: Handles<[AmalgamatorClient, number]> =
        new Handles();
    protected variableHandles: Handles<[AmalgamatorClient, number]> =
        new Handles();

    constructor() {
        super();
        this.logger = logger;
    }

    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        args: DebugProtocol.InitializeRequestArguments
    ): void {
        this.initializeRequestArgs = args;
        /**
         * TODO: When combinging a bunch of cdt-gdb-adapters this is fine as these are the same settings
         * as in GDBDebugSession.initializeRequest -- but when we combine unrelated debuggers then we
         * need to know what the individual child adapters supports are - but at this point in the
         * launch sequence we can't know that as that information is in LaunchRequestArguments. This
         * can be partially solved (as hints to frontend) with CapabilitiesEvent.
         */
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsSetVariable = true;
        response.body.supportsConditionalBreakpoints = true;
        response.body.supportsHitConditionalBreakpoints = true;
        response.body.supportsLogPoints = true;
        response.body.supportsFunctionBreakpoints = true;
        //  response.body.supportsSetExpression = true;
        response.body.supportsDisassembleRequest = true;
        response.body.supportsReadMemoryRequest = true;
        response.body.supportsWriteMemoryRequest = true;
        this.sendResponse(response);
    }

    protected async launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: LaunchRequestArguments
    ): Promise<void> {
        try {
            logger.setup(
                args.verbose ? Logger.LogLevel.Verbose : Logger.LogLevel.Warn,
                args.logFile || false
            );

            for (const child of args.children) {
                if (child.delay) {
                    logger.verbose(
                        `waiting ${child.delay}ms before starting ${child.debugAdapterRuntime} ${child.debugAdapterExecutable}`
                    );
                    await new Promise((res) => setTimeout(res, child.delay));
                }
                const dc = await this.createChild(child, this.childDaps.length);
                this.childDaps.push(dc);
                this.childDapNames.push(child.name ? child.name : '');
            }
            this.sendEvent(new InitializedEvent());
            this.sendResponse(response);
        } catch (err) {
            // TODO cleanup already done launches
            this.sendErrorResponse(
                response,
                1,
                err instanceof Error ? err.message : String(err)
            );
        }
    }

    protected async startAmalgamatorClient(
        child: ChildDapArguments,
        index: number
    ) {
        logger.verbose(
            `creating debug adapter ${child.debugAdapterRuntime} ${child.debugAdapterExecutable}`
        );
        const dc = new AmalgamatorClient(
            child.debugAdapterRuntime,
            child.debugAdapterExecutable,
            'unused'
        );
        // TODO get startup sequence right here (i.e. wait for child's InitializedEvent)

        dc.on('output', (event) => {
            const e = <DebugProtocol.OutputEvent>event;
            if (e.body.category == 'stdout') {
                let output = e.body.output.trimEnd();
                if (output.startsWith('To client: ')) {
                    output =
                        'To amalgamator: ' +
                        output.substr('To client: '.length);
                    logger.verbose(output);
                } else if (output.startsWith('From client: ')) {
                    output =
                        'From amalgamator: ' +
                        output.substr('From client: '.length);
                    logger.verbose(output);
                }
                this.sendEvent(e);
            } else {
                this.sendEvent(e);
            }
        }).on('stopped', async (event) => {
            const e = <DebugProtocol.StoppedEvent>event;
            const reason = e.body.reason;
            const intiatingThreadId = e.body.threadId;

            const threadMap = await this.getThreadMap();
            let stoppedDapIndex = -1;
            // First send the event for the stopped thread
            threadMap.forEach(([childDapIndex, childId], clientId) => {
                if (childDapIndex === index && childId == intiatingThreadId) {
                    this.sendEvent(
                        new StoppedEvent(reason, clientId, false, false)
                    );
                    stoppedDapIndex = childDapIndex;
                }
            });
            // then send the event for all the other stopped threads in the same child
            if (e.body.allThreadsStopped) {
                threadMap.forEach(([childDapIndex, childId], clientId) => {
                    if (
                        childDapIndex === stoppedDapIndex &&
                        childId != intiatingThreadId
                    ) {
                        this.sendEvent(
                            new StoppedEvent(reason, clientId, true, false)
                        );
                    }
                });
            }
        });

        await dc.start();
        await dc.initializeRequest(this.initializeRequestArgs);
        return dc;
    }

    protected async createChild(child: ChildDapArguments, index: number) {
        const dc = await this.startAmalgamatorClient(child, index);
        if (child.request === 'attach') {
            await dc.attachRequest(child.arguments);
        } else {
            await dc.launchRequest(child.arguments);
        }
        return dc;
    }

    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): Promise<void> {
        const responses = await Promise.all(
            this.childDaps.map((dc) => dc.setBreakpointsRequest(args))
        );
        response.body = responses[0].body;
        //breakpointHandles
        // XXX: assert that respones[?].body.breakpoints.length == args.breakpoints.length
        // XXX: assert that the non-deprecated args.breakpoints is used (and not args.lines)
        // TODO: Handle the case where a breakpoint is resolved to different things on different childDaps
        //       see https://github.com/microsoft/debug-adapter-protocol/issues/13 and https://github.com/eclipse-cdt/cdt-gdb-adapter/issues/64
        if (args.breakpoints) {
            for (let i = 0; i < args.breakpoints.length; i++) {
                responses.forEach((response, i) => {
                    response.body.breakpoints.forEach((bp) => {
                        if (bp.id) {
                            bp.id = this.breakpointHandles.create([
                                this.childDaps[i],
                                bp.id,
                            ]);
                        }
                    });
                });

                // choose the first verified response
                const selected = responses.find(
                    (r) => r.body.breakpoints[i].verified
                );
                if (selected) {
                    response.body.breakpoints[i] = selected.body.breakpoints[i];
                }
            }
        }

        this.sendResponse(response);
    }

    protected async configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        args: DebugProtocol.ConfigurationDoneArguments
    ): Promise<void> {
        await Promise.all(
            this.childDaps.map(
                async (dc) => await dc.configurationDoneRequest(args)
            )
        );
        // TODO handle case that child returns an error (for every request!)
        this.sendResponse(response);
    }

    /**
     * This is a map of the thread ID that client sees -> child DAP index, child DAP thread id
     */
    protected async getThreadInfo(
        clientThreadId: number
    ): Promise<[number, number]> {
        const threadMap = await this.getThreadMap();
        const threadInfo = threadMap.get(clientThreadId);
        if (!threadInfo) {
            const msg = `Missing information on client threadId ${clientThreadId} from threadMap: ${threadMap}`;
            logger.error(msg);
            // TODO how best to handle this error
            return [0, 0];
        } else {
            return threadInfo;
        }
    }
    private threadMapInProcess:
        | Promise<[Map<number, [number, number]>, ThreadInfo[]]>
        | undefined;
    protected async getThreadMap(): Promise<Map<number, [number, number]>> {
        return new Promise<Map<number, [number, number]>>(
            (resolve, _reject) => {
                this.getThreadMapInternal().then(([threadMap]) =>
                    resolve(threadMap)
                );
            }
        );
    }
    protected getThreadMapInternal(): Promise<
        [Map<number, [number, number]>, ThreadInfo[]]
    > {
        if (this.threadMapInProcess === undefined) {
            return this.collectChildTheads();
        }
        return this.threadMapInProcess;
    }

    private collectChildTheads(): Promise<
        [Map<number, [number, number]>, ThreadInfo[]]
    > {
        this.threadMapInProcess = new Promise((resolve, _reject) => {
            const threads: ThreadInfo[] = [];
            Promise.all(this.childDaps.map((dc) => dc.threadsRequest())).then(
                (responses) => {
                    const threadMap: Map<number, [number, number]> = new Map<
                        number,
                        [number, number]
                    >();
                    let clientId = 1000;
                    responses.forEach((r, i) => {
                        r.body.threads.forEach((t) => {
                            threads.push({
                                id: clientId,
                                name: `${
                                    this.childDapNames[i]
                                        ? this.childDapNames[i] + ': '
                                        : ''
                                } ${t.name}`, // XXX: prefix name here with which child this came from? What about the id of the child?
                                running:
                                    'running' in t
                                        ? (t as ThreadInfo).running
                                        : undefined,
                            } as ThreadInfo);
                            threadMap.set(clientId, [i, t.id]);
                            clientId++;
                        });
                    });
                    resolve([threadMap, threads]);
                }
            );
        });
        return this.threadMapInProcess;
    }

    protected async threadsRequest(
        response: DebugProtocol.ThreadsResponse
    ): Promise<void> {
        const [, threads] = await this.collectChildTheads();
        response.body = {
            threads,
        };
        this.sendResponse(response);
    }

    protected async stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments
    ): Promise<void> {
        try {
            const [childIndex, childId] = await this.getThreadInfo(
                args.threadId
            );
            args.threadId = childId;
            const childDap = this.childDaps[childIndex];
            const childResponse = await childDap.stackTraceRequest(args);
            const frames = childResponse.body.stackFrames;
            // XXX: When does frameHandles get reset as we don't have a "stopped all"
            frames.forEach((frame) => {
                frame.id = this.frameHandles.create([childDap, frame.id]);
                if (frame.instructionPointerReference) {
                    this.addressMap.set(
                        frame.instructionPointerReference,
                        childIndex
                    );
                }
            });
            response.body = childResponse.body;
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(
                response,
                1,
                err instanceof Error ? err.message : String(err)
            );
        }
    }
    protected async scopesRequest(
        response: DebugProtocol.ScopesResponse,
        args: DebugProtocol.ScopesArguments
    ): Promise<void> {
        const [childDap, childFrameId] = this.frameHandles.get(args.frameId);
        const scopes = await childDap.scopesRequest({ frameId: childFrameId });
        scopes.body.scopes.forEach(
            (scope) =>
                (scope.variablesReference = this.variableHandles.create([
                    childDap,
                    scope.variablesReference,
                ]))
        );
        response.body = scopes.body;
        this.sendResponse(response);
    }

    protected async variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ): Promise<void> {
        const [childDap, childVariablesReference] = this.variableHandles.get(
            args.variablesReference
        );
        args.variablesReference = childVariablesReference;
        const variables = await childDap.variablesRequest(args);
        variables.body.variables.forEach((variable) => {
            if (variable.variablesReference) {
                variable.variablesReference = this.variableHandles.create([
                    childDap,
                    variable.variablesReference,
                ]);
            }
        });
        response.body = variables.body;
        this.sendResponse(response);
    }

    protected async setVariableRequest(
        response: DebugProtocol.SetVariableResponse,
        args: DebugProtocol.SetVariableArguments
    ): Promise<void> {
        const [childDap, childVariablesReference] = this.variableHandles.get(
            args.variablesReference
        );
        args.variablesReference = childVariablesReference;
        const variables = await childDap.setVariableRequest(args);
        response.body = variables.body;
        this.sendResponse(response);
    }

    protected async evaluateRequest(
        response: DebugProtocol.EvaluateResponse,
        args: DebugProtocol.EvaluateArguments
    ): Promise<void> {
        if (args.frameId) {
            try {
                const [childDap, childFrameId] = this.frameHandles.get(
                    args.frameId
                );
                args.frameId = childFrameId;
                const evaluate = await childDap.evaluateRequest(args);
                response.body = evaluate.body;
                this.sendResponse(response);
            } catch (err) {
                this.sendErrorResponse(
                    response,
                    1,
                    err instanceof Error ? err.message : String(err)
                );
            }
        } else {
            this.sendErrorResponse(
                response,
                1,
                'Cannot get evaluate expression'
            );
        }
    }

    protected async disassembleRequest(
        response: DebugProtocol.DisassembleResponse,
        args: DebugProtocol.DisassembleArguments
    ): Promise<void> {
        if (args.memoryReference) {
            response.body = {
                instructions: [],
            };
            try {
                this.childDapIndex = this.addressMap.has(args.memoryReference)
                    ? this.addressMap.get(args.memoryReference)
                    : this.childDapIndex;
                if (this.childDapIndex !== undefined) {
                    const disassemble = await this.childDaps[
                        this.childDapIndex
                    ].disassembleRequest(args);
                    response.body = disassemble.body;
                    const instructions = disassemble.body?.instructions;
                    if (instructions !== undefined) {
                        this.addressMap.set(
                            instructions[0].address,
                            this.childDapIndex
                        );
                        this.addressMap.set(
                            instructions[instructions.length - 1].address,
                            this.childDapIndex
                        );
                        this.sendResponse(response);
                    } else {
                        this.sendErrorResponse(
                            response,
                            1,
                            'Cannot get disassembled data'
                        );
                    }
                } else {
                    this.sendErrorResponse(
                        response,
                        1,
                        'Cannot determine the index of the child Dap'
                    );
                }
            } catch (err) {
                this.sendErrorResponse(
                    response,
                    1,
                    err instanceof Error ? err.message : String(err)
                );
            }
        } else {
            this.sendErrorResponse(response, 1, 'Cannot get disassembled data');
        }
    }

    protected async nextRequest(
        response: DebugProtocol.NextResponse,
        args: DebugProtocol.NextArguments
    ): Promise<void> {
        const [childIndex, childId] = await this.getThreadInfo(args.threadId);
        args.threadId = childId;
        const childDap = this.childDaps[childIndex];
        const childResponse = await childDap.nextRequest(args);
        response.body = childResponse.body;
        this.sendResponse(response);
    }

    protected async stepInRequest(
        response: DebugProtocol.StepInResponse,
        args: DebugProtocol.StepInArguments
    ): Promise<void> {
        const [childIndex, childId] = await this.getThreadInfo(args.threadId);
        args.threadId = childId;
        const childDap = this.childDaps[childIndex];
        const childResponse = await childDap.stepInRequest(args);
        response.body = childResponse.body;
        this.sendResponse(response);
    }

    protected async stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        args: DebugProtocol.StepOutArguments
    ): Promise<void> {
        const [childIndex, childId] = await this.getThreadInfo(args.threadId);
        args.threadId = childId;
        const childDap = this.childDaps[childIndex];
        const childResponse = await childDap.stepOutRequest(args);
        response.body = childResponse.body;
        this.sendResponse(response);
    }

    protected async continueRequest(
        response: DebugProtocol.ContinueResponse,
        args: DebugProtocol.ContinueArguments
    ): Promise<void> {
        const [childIndex, childId] = await this.getThreadInfo(args.threadId);
        args.threadId = childId;
        const childDap = this.childDaps[childIndex];
        const childResponse = await childDap.continueRequest(args);
        response.body = childResponse.body;
        if (this.childDaps.length > 1) {
            if (childResponse.body === undefined) {
                response.body = {};
            }
            response.body.allThreadsContinued = false;
        }
        this.sendResponse(response);
    }

    protected async pauseRequest(
        response: DebugProtocol.PauseResponse,
        args: DebugProtocol.PauseArguments
    ): Promise<void> {
        const [childIndex, childId] = await this.getThreadInfo(args.threadId);
        args.threadId = childId;
        const childDap = this.childDaps[childIndex];
        const childResponse = await childDap.pauseRequest(args);
        response.body = childResponse.body;
        this.sendResponse(response);
    }

    protected async customRequest(
        command: string,
        response: DebugProtocol.Response,
        args: any
    ): Promise<void> {
        if (command === 'cdt-amalgamator/getChildDapNames') {
            response.body = {
                children: this.childDapNames,
            } as ChildDapContents;
            this.sendResponse(response);
        } else if (command === 'cdt-amalgamator/Memory') {
            if (typeof args.address !== 'string') {
                throw new Error(
                    `Invalid type for 'address', expected string, got ${typeof args.address}`
                );
            }
            if (typeof args.length !== 'number') {
                throw new Error(
                    `Invalid type for 'length', expected number, got ${typeof args.length}`
                );
            }
            if (typeof args.child !== 'number') {
                throw new Error(
                    `Invalid type for 'child', expected number, got ${typeof args.child}`
                );
            }
            const childResponse = await this.childDaps[
                args.child
            ].customRequest('cdt-gdb-adapter/Memory', args);
            response.body = childResponse.body;
            this.sendResponse(response);
        } else if (
            command === 'cdt-amalgamator/resumeAll' ||
            command === 'cdt-amalgamator/suspendAll'
        ) {
            const [, threads] = await this.collectChildTheads();
            for (const thread of threads) {
                const [childIndex, childId] = await this.getThreadInfo(
                    thread.id
                );
                const childDap = this.childDaps[childIndex];
                if (
                    thread.running === false &&
                    command === 'cdt-amalgamator/resumeAll'
                ) {
                    await childDap.continueRequest({ threadId: childId });
                    this.sendEvent(new ContinuedEvent(thread.id, false));
                } else if (
                    thread.running === true &&
                    command === 'cdt-amalgamator/suspendAll'
                ) {
                    await childDap.pauseRequest({ threadId: childId });
                    this.sendEvent(
                        new StoppedEvent('SIGINT', thread.id, true, false)
                    );
                }
            }
            this.sendResponse(response);
        } else {
            return super.customRequest(command, response, args);
        }
    }
}
