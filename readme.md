# Eclipse CDT Debug Adapter Amalgamator

The Eclipse CDT Debug Adapter Amalgamator was a proof of concept and has now been archived.
Please see the [discussion in Issue #22](https://github.com/eclipse-cdt-cloud/cdt-amalgamator/issues/22) for additional details.

This is a debug adapter that allows common control over multiple debug adapters simultaneously,
amalgamating their outputs to provide to VSCode a single Debug Adapter interface.

## Using the Amalgamator

The amalgamator is not published and can be run within a VS Code debug session.

-   Checkout this repository
-   Checkout https://github.com/eclipse-cdt/cdt-gdb-vscode
-   Add both repositories to a new VSCode workspace
-   Build both repositories (`yarn && yarn build`)
-   Build the sample application (`make -C sampleWorkspace`)
-   Launch the `Extension` launch configuration from `.vscode/launch.json`
-   Place a breakpoint on `empty1.c` and `empty2.c`
    -   These two files represent the two processes in a multi-process debug session
-   Update the paths to `cdt-gdb-adapter/dist/debugAdapter.js` in the sample workspace's `launch.json`
-   In the _Extension Development Host_ launch the `Amalgamator Example`
-   Debug the two processes, e.g.
    -   step the processes independently
    -   observe variables in different processes
    -   examine memory with the memory browser (`Ctrl+Shift-P` -> _GDB: Open Memory Browser_)

## Background of the Amalgamator

Please see the [`cdt-amalgamator.pdf`](./cdt-amalgamator.pdf) presentation for reference to how the amalgamator was originally envisioned
and more information of the problem statement that it was trying to solve.
