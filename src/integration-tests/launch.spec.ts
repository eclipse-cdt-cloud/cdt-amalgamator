/*********************************************************************
 * Copyright (c) 2018 Ericsson and others
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *********************************************************************/

import { expect } from 'chai';
import * as path from 'path';
import { LaunchRequestArguments } from '../AmalgamatorSession';
import * as cdtgdb from 'cdt-gdb-adapter';
import { CdtDebugClient } from './debugClient';
import {
    resolveLineTagLocations,
    standardBeforeEach,
    testProgramsDir,
} from './utils';
import { gdbPath, openGdbConsole } from './utils';
// import { DebugProtocol } from '@vscode/debugprotocol';

describe('launch', function () {
    let dc: CdtDebugClient;
    const emptyProgram1 = path.join(testProgramsDir, 'empty1');
    const emptySrc1 = path.join(testProgramsDir, 'empty1.c');
    const lineTags1 = {
        'STOP HERE': 0,
    };
    const emptyProgram2 = path.join(testProgramsDir, 'empty2');
    const emptySrc2 = path.join(testProgramsDir, 'empty2.c');
    const lineTags2 = {
        'STOP HERE': 0,
    };
    // const emptySpaceProgram = path.join(testProgramsDir, 'empty space');
    // const emptySpaceSrc = path.join(testProgramsDir, 'empty space.c');

    before(function () {
        resolveLineTagLocations(emptySrc1, lineTags1);
        resolveLineTagLocations(emptySrc2, lineTags2);
    });

    beforeEach(async function () {
        dc = await standardBeforeEach();
    });

    afterEach(async function () {
        await dc.stop();
    });

    // Move the timeout out of the way if the adapter is going to be debugged.
    if (process.env.INSPECT_DEBUG_ADAPTER) {
        this.timeout(9999999);
    }

    it('can launch and hit a breakpoint', async function () {
        await dc.hitBreakpoint(
            {
                verbose: true,
                logFile: '/tmp/log/amalgamator.log',
                children: [
                    {
                        name: 'proc1',
                        debugAdapterRuntime: 'node',
                        debugAdapterExecutable: path.resolve(
                            __dirname,
                            '../../node_modules/cdt-gdb-adapter/dist/debugAdapter.js'
                        ),
                        arguments: {
                            verbose: true,
                            logFile: '/tmp/log/child1.log',
                            gdb: gdbPath,
                            program: emptyProgram1,
                            openGdbConsole,
                        } as cdtgdb.LaunchRequestArguments,
                    },
                ],
            } as LaunchRequestArguments,
            {
                path: emptySrc1,
                line: lineTags1['STOP HERE'],
            }
        );
    });

    it('can launch two children and hit a breakpoint', async function () {
        await dc.hitBreakpoints(
            {
                verbose: true,
                logFile: '/tmp/log/amalgamator.log',
                children: [
                    {
                        name: 'proc1',
                        debugAdapterRuntime: 'node',
                        debugAdapterExecutable: path.resolve(
                            __dirname,
                            '../../node_modules/cdt-gdb-adapter/dist/debugAdapter.js'
                        ),
                        arguments: {
                            verbose: true,
                            logFile: '/tmp/log/child1.log',
                            gdb: gdbPath,
                            program: emptyProgram1,
                            openGdbConsole,
                        } as cdtgdb.LaunchRequestArguments,
                    },
                    {
                        name: 'proc2',
                        debugAdapterRuntime: 'node',
                        debugAdapterExecutable: path.resolve(
                            __dirname,
                            '../../node_modules/cdt-gdb-adapter/dist/debugAdapter.js'
                        ),
                        arguments: {
                            verbose: true,
                            logFile: '/tmp/log/child2.log',
                            gdb: gdbPath,
                            program: emptyProgram2,
                            openGdbConsole,
                        } as cdtgdb.LaunchRequestArguments,
                    },
                ],
            } as LaunchRequestArguments,

            [
                {
                    path: emptySrc1,
                    line: lineTags1['STOP HERE'],
                },
                {
                    path: emptySrc2,
                    line: lineTags2['STOP HERE'],
                },
            ]
        );
    });

    it('reports an error when child launch fails', async function () {
        const errorMessage = await new Promise<Error>((resolve, reject) => {
            dc.launchRequest({
                verbose: true,
                logFile: '/tmp/log/amalgamator.log',
                children: [
                    {
                        name: 'proc1',
                        debugAdapterRuntime: 'node',
                        debugAdapterExecutable: path.resolve(
                            __dirname,
                            '../../node_modules/cdt-gdb-adapter/dist/debugAdapter.js'
                        ),
                        arguments: {
                            verbose: false,
                            logFile: '/tmp/log/child1.log',
                            gdb: gdbPath,
                            program: '/does/not/exist',
                            openGdbConsole,
                        } as cdtgdb.LaunchRequestArguments,
                    },
                ],
            } as LaunchRequestArguments)
                .then(reject)
                .catch(resolve);
        });

        // When launching a remote test gdbserver generates the error which is not exactly the same
        // as GDB's error
        expect(errorMessage.message).to.satisfy(
            (msg: string) =>
                msg.includes('/does/not/exist') &&
                (msg.includes('The system cannot find the path specified') ||
                    msg.includes('No such file or directory') ||
                    msg.includes('not found'))
        );
    });

    it('reports an error when child debug adapter fails to load - missing module', async function () {
        // TODO: This test fails because we use vscode-debugadapter-node/testSupport/src/debugClient.ts::start to start
        // the server and that doesn't really handle this case so we'll need something local
        const errorMessage = await new Promise<Error>((resolve, reject) => {
            dc.launchRequest({
                verbose: true,
                logFile: '/tmp/log/amalgamator.log',
                children: [
                    {
                        name: 'proc1',
                        debugAdapterRuntime: 'node',
                        debugAdapterExecutable: path.resolve(
                            __dirname,
                            '../../node_modules/cdt-gdb-adapter/dist/does/not/exist'
                        ),
                        arguments: {
                            verbose: false,
                            logFile: '/tmp/log/child1.log',
                            gdb: gdbPath,
                            program: emptyProgram1,
                            openGdbConsole,
                        } as cdtgdb.LaunchRequestArguments,
                    },
                ],
            } as LaunchRequestArguments)
                .then(reject)
                .catch(resolve);
        });

        // The specific error message isn't very important and subject
        // to change.
        expect(errorMessage.message).to.contain('Child debug adapter exited');
        // There should be some kind of indication in the error message related back to the
        // failed launch
        expect(errorMessage.message).to.contain('does/not/exist');
    });
});
