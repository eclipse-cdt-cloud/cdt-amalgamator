/*********************************************************************
 * Copyright (c) 2022 Kichwa Coders Canada Inc. and others
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *********************************************************************/

import * as cp from 'child_process';
import { DebugClient } from '@vscode/debugadapter-testsupport';
import { DebugProtocol } from '@vscode/debugprotocol';
import { logger } from '@vscode/debugadapter/lib/logger';

export class AmalgamatorClient extends DebugClient {
    private clientExited = false;
    // There should not be any error output from a client - any error is probably fatal.
    private errorOutput = '';

    public hasClientExited() {
        return this.clientExited;
    }

    private getPendingRequests(): Map<
        number,
        (e: DebugProtocol.Response) => void
    > {
        // XXX: Access private _adapterProcess with this trick
        return (<any>this).pendingRequests;
    }

    private clearPendingRequests() {
        const pending = this.getPendingRequests();
        pending.forEach((clb) => {
            const error = <DebugProtocol.ErrorResponse>{
                message:
                    "Child debug adapter exited. See log for more details. Process' errors: " +
                    this.errorOutput,
            };
            clb(error);
        });
        pending.clear();
    }

    private getAdapterProcess(): cp.ChildProcess {
        // XXX: Access private _adapterProcess with this trick
        return (<any>this)._adapterProcess;
    }

    public async start(port?: number): Promise<void> {
        await super.start(port);

        if (typeof port !== 'number') {
            this.getAdapterProcess().on(
                'exit',
                (_code: number, _signal: string) => {
                    this.clientExited = true;
                    this.clearPendingRequests();
                }
            );
            this.getAdapterProcess().stderr?.on('data', (data) => {
                logger.error(data.toString());
                this.errorOutput += data.toString();
            });
            this.getAdapterProcess().on('error', (err) => {
                this.clientExited = true;
                logger.error(err.toString());
                this.errorOutput += err.toString();
                this.clearPendingRequests();
            });
        }
    }
}
