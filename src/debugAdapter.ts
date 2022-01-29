/*********************************************************************
 * Copyright (c) 2021 Kichwa Coders Canada Inc. and others
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *********************************************************************/
import * as process from 'process';
import { logger } from '@vscode/debugadapter/lib/logger';
import { AmalgamatorSession } from './AmalgamatorSession';

process.on('uncaughtException', (err: any) => {
    logger.error(JSON.stringify(err));
});

AmalgamatorSession.run(AmalgamatorSession);
